/* ===========================================================================
   Liquid Glass Optics — standalone physical refraction, Fresnel, spectral,
   Beer–Lambert, and 9-slice tile geometry engine. Zero DOM, pure math.

   Laws enforced:
     1. Strict h(0) = 0 boundary continuity -> d(0) = 0 and d(b) = 0 (zero teleport).
     2. Worst-case Blue-channel press fold-free Jacobian guard: min(1 + M*d') >= 0.20.
     3. 3D bezel-normal dual-bounce Schlick Fresnel, box-filtered across DPR 1x-3x
        with zero uniform wireframe outline.
     4. 5-band continuous spectral weights summing to exact (1, 1, 1) white and
        transparent-safe Aave content-path normalized coverage.
     5. Beer–Lambert volumetric absorption composited via seam-free overlays.
   =========================================================================== */

import {
  fieldDataUrl,
  fieldSvg,
  overlayPieces,
  PIECE_ORDER,
  SEAM_MARGIN,
  type AlphaSheet,
  type ColorSheet,
  type Corner,
  type Piece,
  type Side,
  type Tile,
} from "./overlay.ts";
import { roundedRectSdf } from "./sdf.ts";

export type GlassShapeProfile = "circle" | "c2squircle" | "squircle";

export interface Srgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface GlassOptics {
  /** Bezel width b (CSS px): outer curved band where refraction and Fresnel live. */
  readonly bezel: number;
  /** Plateau thickness T (CSS px): vertical glass height across the flat interior. */
  readonly thickness: number;
  /** Refractive index n (Schott N-BK7 crown glass d-line default = 1.5168). */
  readonly ior: number;
  /** Height profile f(x) enforcing h(0) = 0, h(b) = T, h'(b) = 0. */
  readonly profile: GlassShapeProfile;
  /** Minimum sampling Jacobian min(1 + M_max * d'(s)) enforced by fold clamp. */
  readonly minJacobian: number;
  /** Largest downstream scale multiplier (strength * pressGain * blueBandFactor). */
  readonly maxMultiplier?: number;
}

export interface DualLightingSpec {
  /** Screen-space direction the key light comes FROM, degrees (-90 = top, -125 = upper-left). */
  readonly angleDeg: number;
  /** Key light elevation z of unnormalized (cos, sin, lift). */
  readonly lift: number;
  /** Specular lobe exponent on N·L. */
  readonly exponent: number;
  /** Opposite-edge internal reflection lobe amplitude (fraction of primary lobe, 0..1). */
  readonly backBounce: number;
  /** Highlight color; `a` calibrates the first CSS px of rim facing the key light. */
  readonly highlight: Srgba;
  /** Grounding shade color; `a` calibrates the first CSS px facing away. */
  readonly shade: Srgba;
}

export interface SpectralBand {
  readonly id: string;
  /** Signed displacement scale offset multiplied by delta (negative = red, positive = blue). */
  readonly offset: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface GlassDispersionSpec {
  readonly nC: number;
  readonly nd: number;
  readonly nF: number;
}

/** Schott N-BK7 optical crown glass: C (656.3 nm), d (587.6 nm), F (486.1 nm). */
export const BK7: GlassDispersionSpec = { nC: 1.5143, nd: 1.5168, nF: 1.5224 };

/** Abbe number V_d = (n_d - 1) / (n_F - n_C). */
export function abbeNumber(glass: GlassDispersionSpec): number {
  return (glass.nd - 1) / (glass.nF - glass.nC);
}

/** Per-channel displacement factors relative to green d-line. */
export function dispersionFactors(glass: GlassDispersionSpec): {
  r: number;
  g: number;
  b: number;
} {
  const base = glass.nd - 1;
  return { r: (glass.nC - 1) / base, g: 1, b: (glass.nF - 1) / base };
}

/**
 * 5-band continuous spectral weights (656 nm C-line to 455 nm F/g-line).
 * Channel weights sum to exact (1.00, 1.00, 1.00) so flat interior pixels
 * preserve white and mid-grey with 0/255 error.
 */
export const SPECTRAL_BANDS: readonly SpectralBand[] = [
  { id: "r", offset: -1.0, r: 0.5, g: 0, b: 0 },
  { id: "y", offset: -0.45, r: 0.5, g: 0.33, b: 0 },
  { id: "g", offset: 0.0, r: 0, g: 0.34, b: 0 },
  { id: "c", offset: 0.5, r: 0, g: 0.33, b: 0.5 },
  { id: "b", offset: 1.1, r: 0, g: 0, b: 0.5 },
];

/** Maximum half-spread delta at dispersion = 1.0. */
const MAX_SPECTRAL_DELTA = 0.14;
const C2_SMOOTHSTEP_MIX = 0.55;
const SLOPE_DX = 1e-4;
const CLAMP_SAMPLES = 1200;
export const HARD_MIN_JACOBIAN = 0.2;
const HARD_MAX_JACOBIAN = 0.55;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Maps UI dispersion [0, 1] to spectral half-spread delta in [0, 0.14]. */
export function spectralDelta(dispersion: number): number {
  return clamp01(dispersion) * MAX_SPECTRAL_DELTA;
}

/** Largest wavelength scale factor (Blue/Violet band) for worst-case fold clamping. */
export function maxSpectralFactor(dispersion: number): number {
  const blueOffset = SPECTRAL_BANDS[SPECTRAL_BANDS.length - 1].offset;
  return 1 + blueOffset * spectralDelta(dispersion);
}

/** Normalized per-band alpha weight for Aave content-path `filter: url()` refraction. */
export function contentSpectralBandAlpha(band: SpectralBand): number {
  void band;
  return 1 / SPECTRAL_BANDS.length;
}

/* ---- Fresnel & Beer–Lambert ---------------------------------------------- */

/** Normal-incidence reflectance R0 = ((n - 1) / (n + 1))^2. */
export function fresnelR0(ior: number): number {
  return ((ior - 1) / (ior + 1)) ** 2;
}

/** Schlick Fresnel reflectance R(theta) = R0 + (1 - R0) * (1 - cos theta)^5. */
export function fresnelSchlick(cosTheta: number, ior: number): number {
  const r0 = fresnelR0(ior);
  return r0 + (1 - r0) * (1 - clamp01(cosTheta)) ** 5;
}

/** Beer–Lambert attenuation coefficient sigma such that 1 - exp(-sigma * T) = plateauAlpha. */
export function absorptionFor(plateauAlpha: number, thickness: number): number {
  return -Math.log(1 - Math.min(clamp01(plateauAlpha), 0.999)) / Math.max(1e-3, thickness);
}

/* ---- Height Profiles & Snell Displacement -------------------------------- */

/** Normalized bezel height f(x) for x in [0, 1], enforcing f(0) = 0, f(1) = 1, f'(1) = 0. */
export function profileHeight(profile: GlassShapeProfile, x: number): number {
  const t = clamp01(x);
  if (profile === "circle") return Math.sqrt(1 - (1 - t) ** 2);
  if (profile === "squircle") return Math.pow(1 - Math.pow(1 - t, 4), 0.25);
  const smooth = t * t * (3 - 2 * t);
  const u = (1 - C2_SMOOTHSTEP_MIX) * t + C2_SMOOTHSTEP_MIX * smooth;
  return Math.pow(1 - Math.pow(1 - u, 4), 0.25);
}

/** Physical surface height h(s) in CSS px. */
export function surfaceHeight(optics: GlassOptics, s: number): number {
  return optics.thickness * profileHeight(optics.profile, s / optics.bezel);
}

/** Physical surface slope h'(s) via central difference. */
export function surfaceSlope(optics: GlassOptics, s: number): number {
  const x = clamp01(s / optics.bezel);
  const a = Math.min(1, x + SLOPE_DX);
  const b = Math.max(0, x - SLOPE_DX);
  const dfdx = (profileHeight(optics.profile, a) - profileHeight(optics.profile, b)) / (a - b);
  return (optics.thickness / optics.bezel) * dfdx;
}

/**
 * Single-interface Snell displacement d(s) = h(s) * tan(theta1 - theta2).
 * Enforces strict boundary continuity h(0) = 0 -> d(0) = 0 and d(b) = 0.
 */
export function rawDisplacementAt(optics: GlassOptics, s: number): number {
  if (s <= 0 || s >= optics.bezel) return 0;
  const theta1 = Math.atan(surfaceSlope(optics, s));
  const theta2 = Math.asin(Math.sin(theta1) / optics.ior);
  return surfaceHeight(optics, s) * Math.tan(theta1 - theta2);
}

export interface ClampTableResult {
  readonly raw: Float64Array;
  readonly clamped: Float64Array;
  readonly folded: boolean;
  readonly rawMinJacobian: number;
  readonly clampedMinJacobian: number;
  readonly dMax: number;
}

/** Builds fold-clamped 1D Snell displacement LUT guaranteeing min(1 + M * d'(s)) >= minJacobian. */
export function buildClampTable(optics: GlassOptics): ClampTableResult {
  const step = optics.bezel / CLAMP_SAMPLES;
  const raw = new Float64Array(CLAMP_SAMPLES + 1);
  for (let i = 0; i <= CLAMP_SAMPLES; i++) {
    raw[i] = rawDisplacementAt(optics, i * step);
  }

  const mult = Math.max(1, optics.maxMultiplier ?? 1);
  let rawMinJacobian = Infinity;
  for (let i = 1; i <= CLAMP_SAMPLES; i++) {
    rawMinJacobian = Math.min(rawMinJacobian, 1 + (mult * (raw[i] - raw[i - 1])) / step);
  }

  const floor = Math.max(HARD_MIN_JACOBIAN, Math.min(HARD_MAX_JACOBIAN, optics.minJacobian));
  const folded = rawMinJacobian < floor;
  const clamped = new Float64Array(CLAMP_SAMPLES + 1);

  if (folded) {
    const rise = ((1 - floor) / mult) * step;
    clamped[CLAMP_SAMPLES] = raw[CLAMP_SAMPLES];
    for (let i = CLAMP_SAMPLES - 1; i >= 0; i--) {
      clamped[i] = Math.min(raw[i], clamped[i + 1] + rise);
    }
  } else {
    clamped.set(raw);
  }

  let dMax = 0;
  let clampedMinJacobian = Infinity;
  for (let i = 0; i <= CLAMP_SAMPLES; i++) {
    if (clamped[i] > dMax) dMax = clamped[i];
    if (i > 0) {
      clampedMinJacobian = Math.min(
        clampedMinJacobian,
        1 + (mult * (clamped[i] - clamped[i - 1])) / step,
      );
    }
  }

  return { raw, clamped, folded, rawMinJacobian, clampedMinJacobian, dMax };
}

function sampleTable(table: Float64Array, bezel: number, s: number): number {
  if (s <= 0 || s >= bezel) return 0;
  const at = (s / bezel) * CLAMP_SAMPLES;
  const i = Math.min(CLAMP_SAMPLES - 1, Math.floor(at));
  const t = at - i;
  return table[i] * (1 - t) + table[i + 1] * t;
}

/* ---- Displacement Byte Encoding & 9-Slice Tile Generation ---------------- */

/** Exact neutral byte for feDisplacementMap so quadrant mirroring (256 - byte) is lossless. */
export const NEUTRAL = 128;

export function encodeDisplacement(u: number): number {
  return NEUTRAL + Math.round(127 * Math.max(-1, Math.min(1, u)));
}

export function decodeDisplacement(byte: number, scale: number): number {
  return scale * (byte / 255 - 0.5);
}

export function displacementScale(dMax: number): number {
  return 2 * dMax;
}

/** DPR capped at 3x for crisp 1-2 px Fresnel/tint overlay sheets. */
export const sheetScale = (dpr: number): number => Math.min(3, Math.max(1, dpr || 1));

/** DPR capped at 2x for smooth bilinear displacement maps. */
export const tileScale = (dpr: number): number => Math.min(2, Math.max(1, dpr || 1));

function makeTile(width: number, height: number): Tile {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function writeDisplacement(tile: Tile, i: number, ux: number, uy: number): void {
  tile.data[i] = encodeDisplacement(ux);
  tile.data[i + 1] = encodeDisplacement(uy);
  tile.data[i + 2] = NEUTRAL;
  tile.data[i + 3] = 255;
}

/** Mirror a displacement tile across X and/or Y, negating flipped components losslessly. */
export function mirrorTile(tile: Tile, flipX: boolean, flipY: boolean): Tile {
  const out = makeTile(tile.width, tile.height);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const sx = flipX ? tile.width - 1 - x : x;
      const sy = flipY ? tile.height - 1 - y : y;
      const si = (sy * tile.width + sx) * 4;
      const di = (y * tile.width + x) * 4;
      out.data[di] = flipX ? 256 - tile.data[si] : tile.data[si];
      out.data[di + 1] = flipY ? 256 - tile.data[si + 1] : tile.data[si + 1];
      out.data[di + 2] = tile.data[si + 2];
      out.data[di + 3] = tile.data[si + 3];
    }
  }
  return out;
}

const STRIP = 2;

export interface DisplacementTileSet {
  readonly dMax: number;
  readonly rawMinJacobian: number;
  readonly clampedMinJacobian: number;
  readonly folded: boolean;
  readonly corners: Record<Corner, Tile>;
  readonly edges: Record<Side, Tile>;
  readonly neutral: Tile;
}

/** Builds fold-free 9-slice Snell displacement tiles (flat interior = exact neutral 128). */
export function buildDisplacementTiles(
  radius: number,
  optics: GlassOptics,
  dpr: number,
): DisplacementTileSet {
  const clampedOptics: GlassOptics =
    optics.bezel <= radius ? optics : { ...optics, bezel: radius };
  const stats = buildClampTable(clampedOptics);
  const { dMax, clamped } = stats;
  const unit = dMax > 0 ? 1 / dMax : 0;

  const rp = Math.max(1, Math.round(radius * dpr));
  const cssPerPx = radius / rp;
  const tl = makeTile(rp, rp);
  for (let j = 0; j < rp; j++) {
    for (let i = 0; i < rp; i++) {
      const x = (i + 0.5) * cssPerPx;
      const y = (j + 0.5) * cssPerPx;
      const { distance, nx, ny } = roundedRectSdf(x - radius, y - radius, radius, radius, radius);
      const s = -distance;
      const d = s > 0 && s < clampedOptics.bezel ? sampleTable(clamped, clampedOptics.bezel, s) : 0;
      writeDisplacement(tl, (j * rp + i) * 4, -nx * d * unit, -ny * d * unit);
    }
  }

  const bp = Math.max(1, Math.round(clampedOptics.bezel * dpr));
  const bezelPerPx = clampedOptics.bezel / bp;
  const top = makeTile(STRIP, bp);
  const left = makeTile(bp, STRIP);
  for (let k = 0; k < bp; k++) {
    const d = sampleTable(clamped, clampedOptics.bezel, (k + 0.5) * bezelPerPx) * unit;
    for (let t = 0; t < STRIP; t++) {
      writeDisplacement(top, (k * STRIP + t) * 4, 0, d);
      writeDisplacement(left, (t * bp + k) * 4, d, 0);
    }
  }

  const neutral = makeTile(1, 1);
  writeDisplacement(neutral, 0, 0, 0);

  return {
    dMax,
    rawMinJacobian: stats.rawMinJacobian,
    clampedMinJacobian: stats.clampedMinJacobian,
    folded: stats.folded,
    corners: {
      tl,
      tr: mirrorTile(tl, true, false),
      bl: mirrorTile(tl, false, true),
      br: mirrorTile(tl, true, true),
    },
    edges: {
      top,
      bottom: mirrorTile(top, false, true),
      left,
      right: mirrorTile(left, true, false),
    },
    neutral,
  };
}

/* ---- SVG Filter 9-Slice Primitive Layout --------------------------------- */

export interface LensRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type LensPart = "neutral" | Side | Corner;

/** feMerge paint order: neutral center, then full-side edge strips, then corners on top. */
export const LENS_ORDER: readonly LensPart[] = [
  "neutral",
  "top",
  "bottom",
  "left",
  "right",
  "tl",
  "tr",
  "bl",
  "br",
];

export interface LensLayout {
  readonly region: LensRect;
  readonly neutral: LensRect;
  readonly edges: Record<Side, LensRect | null>;
  readonly corners: Record<Corner, LensRect>;
}

const STRAIGHT_MIN = 1e-6;

export function lensLayout(
  width: number,
  height: number,
  radius: number,
  bezel: number,
): LensLayout {
  if (bezel > radius + 1e-6) {
    throw new RangeError(`bezel ${bezel}px exceeds corner radius ${radius}px (b <= R)`);
  }
  if (radius > Math.min(width, height) / 2 + 1e-6) {
    throw new RangeError(`radius ${radius}px exceeds half the short side of ${width}x${height}`);
  }
  const region: LensRect = { x: 0, y: 0, width, height };
  const across = width - 2 * radius > STRAIGHT_MIN;
  const down = height - 2 * radius > STRAIGHT_MIN;
  return {
    region,
    neutral: { ...region },
    edges: {
      top: across ? { x: 0, y: 0, width, height: bezel } : null,
      bottom: across ? { x: 0, y: height - bezel, width, height: bezel } : null,
      left: down ? { x: 0, y: 0, width: bezel, height } : null,
      right: down ? { x: width - bezel, y: 0, width: bezel, height } : null,
    },
    corners: {
      tl: { x: 0, y: 0, width: radius, height: radius },
      tr: { x: width - radius, y: 0, width: radius, height: radius },
      bl: { x: 0, y: height - radius, width: radius, height: radius },
      br: { x: width - radius, y: height - radius, width: radius, height: radius },
    },
  };
}

/* ---- Bezel-Normal Dual-Bounce Schlick Fresnel & Beer–Lambert Overlays ---- */

const toByte = (alpha: number) => Math.round(255 * clamp01(alpha));

function walkSheet(
  radius: number,
  dpr: number,
  visit: (
    index: number,
    p: { s: number; nx: number; ny: number; coverage: number; pixel: number },
  ) => void,
  all = false,
): { size: number; slice: number } {
  const rp = Math.max(1, Math.round(radius * dpr));
  const cssPerPx = radius / rp;
  const size = 2 * rp + 1;
  const virtual = 2 * radius + 2;
  const coord = (i: number) =>
    i < rp
      ? (i + 0.5) * cssPerPx
      : i === rp
        ? radius + 1
        : radius + 2 + (i - rp - 1 + 0.5) * cssPerPx;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const { distance, nx, ny } = roundedRectSdf(
        coord(i) - virtual / 2,
        coord(j) - virtual / 2,
        virtual / 2,
        virtual / 2,
        radius,
      );
      const coverage = clamp01(0.5 - distance / cssPerPx);
      if (coverage <= 0 && !all) continue;
      visit(j * size + i, { s: -distance, nx, ny, coverage, pixel: cssPerPx });
    }
  }
  return { size, slice: rp };
}

const RIM_STEP = 1 / 256;
const RIM_SUBSAMPLES = 32;
const RIM_SUBSAMPLES_INNER = 4;
const RIM_STEEP = 2;
const RIM_EPS_S = 1e-3;
const BOUNCE_LIFT_RATIO = 0.7;
const BOUNCE_EXP_OFFSET = 0.4;

function solveDisplayGain(targetA: number, subValues: number[]): number {
  if (targetA <= 0 || subValues.length === 0) return 0;
  const mean = subValues.reduce((a, b) => a + b, 0) / subValues.length;
  if (mean <= 0) return 0;
  const linearGain = targetA / mean;
  const peak = Math.max(...subValues);
  if (linearGain * peak <= 1) return linearGain;
  const floorVal = Math.max(1e-9, Math.min(...subValues));
  if (targetA >= 1) return 1 / floorVal;
  let lo = linearGain;
  let hi = 1 / floorVal;
  for (let iter = 0; iter < 32; iter++) {
    const mid = 0.5 * (lo + hi);
    let sum = 0;
    for (const v of subValues) sum += Math.min(1, mid * v);
    if (sum / subValues.length < targetA) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function dualRimTerms(optics: GlassOptics, spec: DualLightingSpec, pixel: number) {
  const a = (spec.angleDeg * Math.PI) / 180;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  const l1Len = Math.hypot(cosA, sinA, spec.lift);
  const lx = cosA / l1Len;
  const ly = sinA / l1Len;
  const lz = spec.lift / l1Len;

  const bounceLift = spec.lift * BOUNCE_LIFT_RATIO;
  const l2Len = Math.hypot(-cosA, -sinA, bounceLift);
  const l2x = -cosA / l2Len;
  const l2y = -sinA / l2Len;
  const l2z = bounceLift / l2Len;

  const r0 = fresnelR0(optics.ior);
  const n = Math.ceil(optics.bezel / RIM_STEP) + 1;
  const rim = new Float64Array(n + 1);
  const tilt = new Float64Array(n + 1);
  const flat = new Float64Array(n + 1).fill(1);

  for (let i = 0; i < n; i++) {
    const m = surfaceSlope(optics, Math.max(i * RIM_STEP, RIM_EPS_S));
    const q = 1 / Math.sqrt(m * m + 1);
    rim[i] = (fresnelSchlick(q, optics.ior) - r0) / (1 - r0);
    tilt[i] = m * q;
    flat[i] = q;
  }

  const bounceExp = spec.exponent + BOUNCE_EXP_OFFSET;

  const box = (s0: number, s1: number, nx: number, ny: number) => {
    const from = Math.max(0, s0);
    const to = Math.min(optics.bezel, s1);
    if (to <= from) return { highlight: 0, shade: 0 };

    const along1 = nx * lx + ny * ly;
    const along2 = nx * l2x + ny * l2y;
    const count = from < RIM_STEEP ? RIM_SUBSAMPLES : RIM_SUBSAMPLES_INNER;
    let highlight = 0;
    let shade = 0;

    for (let k = 0; k < count; k++) {
      const t = (from + ((to - from) * (k + 0.5)) / count) / RIM_STEP;
      const i = Math.min(n - 1, Math.floor(t));
      const f = t - i;
      const F = rim[i] + (rim[i + 1] - rim[i]) * f;
      const p = tilt[i] + (tilt[i + 1] - tilt[i]) * f;
      const q = flat[i] + (flat[i + 1] - flat[i]) * f;

      const facingPrimary = Math.max(0, p * along1 + q * lz);
      const facingBounce = Math.max(0, p * along2 + q * l2z);
      const primaryLobe = facingPrimary ** spec.exponent;
      const bounceLobe = spec.backBounce * facingBounce ** bounceExp;

      highlight += F * Math.min(1, primaryLobe + bounceLobe);
      shade += F * Math.max(0, 1 - facingPrimary - bounceLobe);
    }

    const w = (to - from) / (s1 - s0) / count;
    return { highlight: highlight * w, shade: shade * w };
  };

  const horz = Math.hypot(lx, ly);
  const sx = horz > 1e-9 ? lx / horz : 0;
  const sy = horz > 1e-9 ? ly / horz : -1;

  const subRows = Math.max(1, Math.round(1 / pixel));
  const hiSubs: number[] = [];
  const shSubs: number[] = [];
  for (let k = 0; k < subRows; k++) {
    hiSubs.push(box(k * pixel, (k + 1) * pixel, sx, sy).highlight);
    shSubs.push(box(k * pixel, (k + 1) * pixel, -sx, -sy).shade);
  }

  return {
    box,
    highlightGain: solveDisplayGain(spec.highlight.a, hiSubs),
    shadeGain: solveDisplayGain(spec.shade.a, shSubs),
  };
}

/** Pure bezel-normal dual-bounce Schlick Fresnel lighting sheets (alpha mask + straight sRGB color). */
export function lightingOverlay(
  radius: number,
  optics: GlassOptics,
  spec: DualLightingSpec,
  dpr = 1,
): { alpha: AlphaSheet; color: ColorSheet } {
  const effOptics: GlassOptics =
    optics.bezel <= radius ? optics : { ...optics, bezel: radius };
  const rp = Math.max(1, Math.round(radius * dpr));
  const pixel = radius / rp;
  const rim = dualRimTerms(effOptics, spec, pixel);
  const size = 2 * rp + 1;
  const alpha = new Uint8ClampedArray(size * size);
  const rgb = new Uint8ClampedArray(size * size * 3);

  const sampleRim = (s: number, nx: number, ny: number, px: number) => {
    if (s - px / 2 >= effOptics.bezel) return { hA: 0, sA: 0 };
    const t = rim.box(s - px / 2, s + px / 2, nx, ny);
    return {
      hA: Math.min(1, rim.highlightGain * t.highlight),
      sA: Math.min(1, rim.shadeGain * t.shade),
    };
  };

  walkSheet(
    radius,
    dpr,
    (index, p) => {
      let { hA, sA } = sampleRim(p.s, p.nx, p.ny, p.pixel);
      alpha[index] = toByte(p.coverage * (hA + sA * (1 - hA)));
      if (hA + sA * (1 - hA) <= 0 && p.s < p.pixel / 2) {
        ({ hA, sA } = sampleRim(p.pixel / 2, p.nx, p.ny, p.pixel));
      }
      const wh = hA;
      const ws = sA * (1 - hA);
      const mix = (h: number, sh: number) =>
        wh + ws > 0 ? Math.round((h * wh + sh * ws) / (wh + ws)) : h;
      rgb[index * 3] = mix(spec.highlight.r, spec.shade.r);
      rgb[index * 3 + 1] = mix(spec.highlight.g, spec.shade.g);
      rgb[index * 3 + 2] = mix(spec.highlight.b, spec.shade.b);
    },
    true,
  );

  return {
    alpha: { size, slice: rp, radius, dpr, alpha },
    color: { size, slice: rp, radius, dpr, rgb },
  };
}

/** Pure Beer–Lambert volumetric body absorption alpha sheet. */
export function tintField(
  radius: number,
  optics: GlassOptics,
  plateauAlpha: number,
  rimMin: number,
  dpr = 1,
  offset = 0,
): AlphaSheet {
  const effOptics: GlassOptics =
    optics.bezel <= radius ? optics : { ...optics, bezel: radius };
  const rp = Math.max(1, Math.round(radius * dpr));
  const size = 2 * rp + 1;
  const alpha = new Uint8ClampedArray(size * size);
  const sigma = absorptionFor(plateauAlpha, effOptics.thickness);

  walkSheet(radius, dpr, (index, p) => {
    const s = Math.min(Math.max(p.s, 0) + offset, effOptics.bezel);
    const h = surfaceHeight(effOptics, s);
    const a = Math.max(Math.min(rimMin, plateauAlpha), 1 - Math.exp(-sigma * h));
    alpha[index] = toByte(p.coverage * a);
  });

  return { size, slice: rp, radius, dpr, alpha };
}

function encodeOverlaySheet(
  sheet: AlphaSheet | ColorSheet,
  border: number,
  asAlpha: boolean,
  encode: (tile: Tile) => string | null,
): string | null {
  const pieces = overlayPieces(sheet, SEAM_MARGIN, border);
  const urls: Partial<Record<Piece, string>> = {};
  for (const name of PIECE_ORDER) {
    const tile = pieces.tiles[name];
    if (!tile) continue;
    const url = encode(tile);
    if (!url) return null;
    urls[name] = url;
  }
  return fieldDataUrl(fieldSvg(pieces, urls, asAlpha));
}

export function bakeLightOverlay(
  radius: number,
  border: number,
  optics: GlassOptics,
  spec: DualLightingSpec,
  dpr: number,
  asAlpha: boolean,
  encode: (tile: Tile) => string | null,
): { mask: string; color: string } | null {
  const { alpha, color } = lightingOverlay(radius, optics, spec, dpr);
  const mask = encodeOverlaySheet(alpha, border, asAlpha, encode);
  const colorUrl = encodeOverlaySheet(color, border, false, encode);
  if (!mask || !colorUrl) return null;
  return { mask, color: colorUrl };
}

export function bakeBodyOverlay(
  radius: number,
  border: number,
  optics: GlassOptics,
  plateauAlpha: number,
  rimMin: number,
  dpr: number,
  asAlpha: boolean,
  encode: (tile: Tile) => string | null,
): string | null {
  const sheet = tintField(radius, optics, plateauAlpha, rimMin, dpr, border);
  return encodeOverlaySheet(sheet, border, asAlpha, encode);
}
