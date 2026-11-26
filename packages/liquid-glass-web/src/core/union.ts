import type { RgbColor } from "./color.ts";
import { polySmin } from "./hicShaders.ts";
import {
  absorptionFor,
  buildClampTable,
  dualRimTerms,
  encodeDisplacement,
  NEUTRAL,
  surfaceHeight,
  type DualLightingSpec,
  type GlassOptics,
} from "./optics.ts";
import type { Tile } from "./overlay.ts";
import { roundedRectSdf } from "./sdf.ts";

export interface UnionCapsule {
  readonly cx: number;
  readonly cy: number;
  readonly hw: number;
  readonly hh: number;
  readonly r: number;
}

export interface PolySminContour {
  readonly path: string;
  readonly gap: number;
  readonly saddleDepth: number;
}

export interface PolySminDisplacementResult {
  readonly tile: Tile;
  readonly dMax: number;
}

export interface PolySminOpticsParams {
  readonly optics: GlassOptics;
  readonly lighting: DualLightingSpec;
  readonly bodyRgb: RgbColor;
  readonly bodyAlpha: number;
  readonly rimAlphaMin: number;
  readonly scrimRgb: RgbColor;
  readonly scrimAlpha: number;
  readonly edgeRgb: RgbColor;
  readonly edgeAlpha: number;
  readonly borderWidth: number;
  /** Pixel scale: 1 while animating, sheetScale(dpr) once settled. */
  readonly scale: number;
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function evalTwoCapsuleSminWithGrad(
  x: number,
  y: number,
  a: UnionCapsule,
  b: UnionCapsule,
  k: number,
): { dist: number; gx: number; gy: number } {
  const sA = roundedRectSdf(x - a.cx, y - a.cy, a.hw, a.hh, a.r);
  const sB = roundedRectSdf(x - b.cx, y - b.cy, b.hw, b.hh, b.r);
  const dA = sA.distance;
  const dB = sB.distance;
  if (k <= 0.001) {
    return dA <= dB
      ? { dist: dA, gx: sA.nx, gy: sA.ny }
      : { dist: dB, gx: sB.nx, gy: sB.ny };
  }
  const diff = Math.abs(dA - dB);
  const h = Math.max(k - diff, 0) / k;
  const dist = Math.min(dA, dB) - h * h * k * 0.25;
  const wA = dA <= dB ? 1 - 0.5 * h : 0.5 * h;
  const wB = 1 - wA;
  return {
    dist,
    gx: wA * sA.nx + wB * sB.nx,
    gy: wA * sA.ny + wB * sB.ny,
  };
}

function evalTwoCapsuleSmin(
  x: number,
  y: number,
  a: UnionCapsule,
  b: UnionCapsule,
  k: number,
): number {
  const dA = roundedRectSdf(x - a.cx, y - a.cy, a.hw, a.hh, a.r).distance;
  const dB = roundedRectSdf(x - b.cx, y - b.cy, b.hw, b.hh, b.r).distance;
  return polySmin(dA, dB, k);
}

/** Closed SVG path of the fused outline, or null when the capsules don't touch (gap >= k/2). */
export function buildPolySminPath(
  a: UnionCapsule,
  b: UnionCapsule,
  k: number,
  samples = 44,
): PolySminContour | null {
  if (k <= 0.001) return null;
  if (a.hw <= 1 || a.hh <= 1 || b.hw <= 1 || b.hh <= 1) return null;

  const left: UnionCapsule =
    a.cx <= b.cx
      ? { ...a, r: Math.min(a.r, a.hw, a.hh) }
      : { ...b, r: Math.min(b.r, b.hw, b.hh) };
  const right: UnionCapsule =
    a.cx <= b.cx
      ? { ...b, r: Math.min(b.r, b.hw, b.hh) }
      : { ...a, r: Math.min(a.r, a.hw, a.hh) };

  const leftRightEdge = left.cx + left.hw;
  const rightLeftEdge = right.cx - right.hw;
  const gap = rightLeftEdge - leftRightEdge;
  const xMid = (leftRightEdge + rightLeftEdge) * 0.5;
  const yMid = (left.cy + right.cy) * 0.5;

  const saddle = evalTwoCapsuleSmin(xMid, yMid, left, right, k);
  if (saddle >= -0.04) return null;

  const rL = left.r;
  const rR = right.r;
  const lx0 = left.cx - left.hw + rL;
  const lx1 = left.cx + left.hw - rL;
  const rx0 = right.cx - right.hw + rR;
  const rx1 = right.cx + right.hw - rR;

  const extraL = Math.max(0, k - rL * 0.75);
  const extraR = Math.max(0, k - rR * 0.75);
  const xJoinL = Math.max(lx0, Math.min(lx1, lx1 - extraL));
  const xJoinR = Math.min(rx1, Math.max(rx0, rx0 + extraR));

  if (xJoinR <= xJoinL + 0.5) return null;

  const yOutTop = Math.min(left.cy - left.hh, right.cy - right.hh) - Math.max(4, k * 0.35);
  const yOutBot = Math.max(left.cy + left.hh, right.cy + right.hh) + Math.max(4, k * 0.35);

  const n = Math.max(16, Math.round(samples));
  const topPts: { x: number; y: number }[] = [];
  const botPts: { x: number; y: number }[] = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const u = 0.35 * t + 0.65 * s;
    const x = xJoinL + (xJoinR - xJoinL) * u;
    const yIn = left.cy + (right.cy - left.cy) * clamp01(u);

    let loT = yOutTop;
    let hiT = yIn;
    for (let iter = 0; iter < 16; iter++) {
      const mid = (loT + hiT) * 0.5;
      if (evalTwoCapsuleSmin(x, mid, left, right, k) > 0) loT = mid;
      else hiT = mid;
    }
    topPts.push({ x, y: (loT + hiT) * 0.5 });

    let loB = yIn;
    let hiB = yOutBot;
    for (let iter = 0; iter < 16; iter++) {
      const mid = (loB + hiB) * 0.5;
      if (evalTwoCapsuleSmin(x, mid, left, right, k) < 0) loB = mid;
      else hiB = mid;
    }
    botPts.push({ x, y: (loB + hiB) * 0.5 });
  }

  const parts: string[] = [];
  parts.push(`M ${fmt(lx0)} ${fmt(left.cy + left.hh)}`);
  parts.push(`A ${fmt(rL)} ${fmt(rL)} 0 0 1 ${fmt(lx0)} ${fmt(left.cy - left.hh)}`);
  if (xJoinL > lx0 + 0.05) {
    parts.push(`L ${fmt(xJoinL)} ${fmt(topPts[0].y)}`);
  }
  for (let i = 1; i < topPts.length; i++) {
    parts.push(`L ${fmt(topPts[i].x)} ${fmt(topPts[i].y)}`);
  }
  if (rx1 > xJoinR + 0.05) {
    parts.push(`L ${fmt(rx1)} ${fmt(right.cy - right.hh)}`);
  }
  parts.push(`A ${fmt(rR)} ${fmt(rR)} 0 0 1 ${fmt(rx1)} ${fmt(right.cy + right.hh)}`);
  if (rx1 > xJoinR + 0.05) {
    parts.push(`L ${fmt(xJoinR)} ${fmt(botPts[botPts.length - 1].y)}`);
  }
  for (let i = botPts.length - 2; i >= 0; i--) {
    parts.push(`L ${fmt(botPts[i].x)} ${fmt(botPts[i].y)}`);
  }
  parts.push("Z");

  return {
    path: parts.join(" "),
    gap,
    saddleDepth: -saddle,
  };
}

/**
 * Displacement tile for the fused shape (Tier 1). Interior pixels are neutral 128,
 * and the saddle between the shapes is damped to match the Tier 0 shader.
 */
export function buildPolySminDisplacementMap(
  widthCss: number,
  heightCss: number,
  a: UnionCapsule,
  b: UnionCapsule,
  k: number,
  optics: GlassOptics,
  scale = 1,
): PolySminDisplacementResult {
  const rMin = Math.min(a.r, a.hw, a.hh, b.r, b.hw, b.hh);
  const effBezel = Math.max(2, Math.min(optics.bezel, rMin));
  const clampedOptics: GlassOptics = { ...optics, bezel: effBezel };
  const stats = buildClampTable(clampedOptics);
  const { dMax, clamped } = stats;
  const unit = dMax > 0 ? 1 / dMax : 0;
  const maxIdx = clamped.length - 1;

  const pw = Math.max(2, Math.round(widthCss * scale));
  const ph = Math.max(2, Math.round(heightCss * scale));
  const dxCss = widthCss / pw;
  const dyCss = heightCss / ph;
  const data = new Uint8ClampedArray(pw * ph * 4);

  const capA: UnionCapsule = { ...a, r: Math.min(a.r, a.hw, a.hh) };
  const capB: UnionCapsule = { ...b, r: Math.min(b.r, b.hw, b.hh) };

  for (let j = 0; j < ph; j++) {
    const y = (j + 0.5) * dyCss;
    for (let i = 0; i < pw; i++) {
      const x = (i + 0.5) * dxCss;
      const idx = (j * pw + i) * 4;
      const { dist, gx, gy } = evalTwoCapsuleSminWithGrad(x, y, capA, capB, k);
      const s = -dist;
      if (s <= 0 || s >= effBezel || unit === 0) {
        data[idx] = NEUTRAL;
        data[idx + 1] = NEUTRAL;
        data[idx + 2] = NEUTRAL;
        data[idx + 3] = 255;
        continue;
      }

      const gLen = Math.hypot(gx, gy);
      const damp = Math.min(1, gLen);
      const nx = gLen > 1e-4 ? (gx / gLen) * damp : 0;
      const ny = gLen > 1e-4 ? (gy / gLen) * damp : 0;

      const at = (s / effBezel) * maxIdx;
      const ti = Math.min(maxIdx - 1, Math.floor(at));
      const tf = at - ti;
      const disp = (clamped[ti] * (1 - tf) + clamped[ti + 1] * tf) * unit;

      data[idx] = encodeDisplacement(-nx * disp);
      data[idx + 1] = encodeDisplacement(-ny * disp);
      data[idx + 2] = encodeDisplacement(0);
      data[idx + 3] = 255;
    }
  }

  return {
    tile: { width: pw, height: ph, data },
    dMax,
  };
}

const RIM_S_BINS = 64;
const RIM_D_BINS = 64;

interface CachedRimLut {
  readonly key: string;
  readonly cosA: number;
  readonly sinA: number;
  readonly bezel: number;
  readonly hA: Float32Array;
  readonly sA: Float32Array;
}

const rimLutCache = new Map<string, CachedRimLut>();
const MAX_RIM_LUT_CACHE = 12;

/** Cached 65x65 LUT of dualRimTerms().box over (depth, N·L), within 0.5/255 of per-pixel integration. */
function getRimLut(optics: GlassOptics, lighting: DualLightingSpec, pixel: number): CachedRimLut {
  const key = [
    optics.profile,
    optics.bezel.toFixed(2),
    optics.thickness.toFixed(2),
    optics.ior.toFixed(4),
    lighting.angleDeg.toFixed(1),
    lighting.lift.toFixed(2),
    lighting.exponent.toFixed(2),
    lighting.backBounce.toFixed(2),
    lighting.highlight.a.toFixed(3),
    lighting.shade.a.toFixed(3),
    pixel.toFixed(3),
  ].join("|");

  const hit = rimLutCache.get(key);
  if (hit) return hit;

  const rim = dualRimTerms(optics, lighting, pixel);
  const rad = (lighting.angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const halfPx = pixel * 0.5;
  const stride = RIM_D_BINS + 1;
  const hA = new Float32Array((RIM_S_BINS + 1) * stride);
  const sA = new Float32Array((RIM_S_BINS + 1) * stride);

  for (let di = 0; di <= RIM_D_BINS; di++) {
    const dot = -1 + (2 * di) / RIM_D_BINS;
    const perp = Math.sqrt(Math.max(0, 1 - dot * dot));
    // Construct a unit normal (nx, ny) whose dot with (cosA, sinA) equals `dot`
    const nx = dot * cosA - perp * sinA;
    const ny = dot * sinA + perp * cosA;
    for (let si = 0; si <= RIM_S_BINS; si++) {
      const s = (si / RIM_S_BINS) * optics.bezel;
      const t = rim.box(s - halfPx, s + halfPx, nx, ny);
      const kIdx = si * stride + di;
      hA[kIdx] = Math.min(1, rim.highlightGain * t.highlight);
      sA[kIdx] = Math.min(1, rim.shadeGain * t.shade);
    }
  }

  const entry: CachedRimLut = { key, cosA, sinA, bezel: optics.bezel, hA, sA };
  if (rimLutCache.size >= MAX_RIM_LUT_CACHE) {
    const oldest = rimLutCache.keys().next().value;
    if (oldest !== undefined) rimLutCache.delete(oldest);
  }
  rimLutCache.set(key, entry);
  return entry;
}

/**
 * Paints tint, scrim, Fresnel rim and edge ring over the fused shape. Uses the same
 * equations as optics.ts, so merged and unmerged surfaces look the same.
 */
export function bakePolySminOptics(
  widthCss: number,
  heightCss: number,
  a: UnionCapsule,
  b: UnionCapsule,
  k: number,
  params: PolySminOpticsParams,
): Tile {
  const pw = Math.max(2, Math.round(widthCss * params.scale));
  const ph = Math.max(2, Math.round(heightCss * params.scale));
  const dxCss = widthCss / pw;
  const dyCss = heightCss / ph;
  const pixel = 0.5 * (dxCss + dyCss);
  const data = new Uint8ClampedArray(pw * ph * 4);

  const capA: UnionCapsule = { ...a, r: Math.min(a.r, a.hw, a.hh) };
  const capB: UnionCapsule = { ...b, r: Math.min(b.r, b.hw, b.hh) };
  const rMin = Math.min(capA.r, capB.r);
  const effBezel = Math.max(2, Math.min(params.optics.bezel, rMin));
  const effOptics: GlassOptics = { ...params.optics, bezel: effBezel };

  const lut = getRimLut(effOptics, params.lighting, pixel);
  const lutStride = RIM_D_BINS + 1;
  const invBezelS = RIM_S_BINS / effBezel;
  const halfDBins = RIM_D_BINS * 0.5;
  const sigma = absorptionFor(params.bodyAlpha, effOptics.thickness);
  const rimFloor = Math.min(params.rimAlphaMin, params.bodyAlpha);

  const { bodyRgb, scrimRgb, scrimAlpha, edgeRgb, edgeAlpha, borderWidth, lighting } = params;
  const hiRgb = lighting.highlight;
  const shRgb = lighting.shade;

  // Flat interior color, used for the bulk fill
  let flatR = bodyRgb.r;
  let flatG = bodyRgb.g;
  let flatB = bodyRgb.b;
  let flatA = Math.max(rimFloor, 1 - Math.exp(-sigma * effOptics.thickness));
  if (scrimAlpha > 0.005) {
    const outA = scrimAlpha + flatA * (1 - scrimAlpha);
    if (outA > 1e-6) {
      flatR = (scrimRgb.r * scrimAlpha + flatR * flatA * (1 - scrimAlpha)) / outA;
      flatG = (scrimRgb.g * scrimAlpha + flatG * flatA * (1 - scrimAlpha)) / outA;
      flatB = (scrimRgb.b * scrimAlpha + flatB * flatA * (1 - scrimAlpha)) / outA;
    }
    flatA = outA;
  }
  const flatByteR = Math.round(flatR);
  const flatByteG = Math.round(flatG);
  const flatByteB = Math.round(flatB);
  const flatByteA = Math.round(255 * clamp01(flatA));

  const halfPx = pixel * 0.5;
  const bezelLimit = effBezel + halfPx;

  for (let j = 0; j < ph; j++) {
    const y = (j + 0.5) * dyCss;
    for (let i = 0; i < pw; i++) {
      const x = (i + 0.5) * dxCss;
      const { dist, gx, gy } = evalTwoCapsuleSminWithGrad(x, y, capA, capB, k);
      const coverage = clamp01(0.5 - dist / pixel);
      if (coverage <= 0) continue;

      const idx = (j * pw + i) * 4;
      const s = -dist;

      // Flat interior: no slope, so no Fresnel and a constant tint
      if (s >= bezelLimit && coverage >= 0.999) {
        data[idx] = flatByteR;
        data[idx + 1] = flatByteG;
        data[idx + 2] = flatByteB;
        data[idx + 3] = flatByteA;
        continue;
      }

      // Body tint (matches tintField() in optics.ts)
      const sBody = Math.min(Math.max(s, 0) + borderWidth, effBezel);
      const h = surfaceHeight(effOptics, sBody);
      let r = bodyRgb.r;
      let g = bodyRgb.g;
      let b = bodyRgb.b;
      let alpha = Math.max(rimFloor, 1 - Math.exp(-sigma * h));

      if (scrimAlpha > 0.005) {
        const outA = scrimAlpha + alpha * (1 - scrimAlpha);
        if (outA > 1e-6) {
          r = (scrimRgb.r * scrimAlpha + r * alpha * (1 - scrimAlpha)) / outA;
          g = (scrimRgb.g * scrimAlpha + g * alpha * (1 - scrimAlpha)) / outA;
          b = (scrimRgb.b * scrimAlpha + b * alpha * (1 - scrimAlpha)) / outA;
        }
        alpha = outA;
      }

      // Fresnel rim from the cached LUT
      if (s < effBezel) {
        const gLen = Math.hypot(gx, gy);
        if (gLen > 1e-4) {
          const nx = gx / gLen;
          const ny = gy / gLen;
          const saddleDamp = gLen >= 0.75 ? 1 : gLen <= 0.15 ? 0 : (gLen - 0.15) / 0.6;
          const dot = Math.max(-1, Math.min(1, nx * lut.cosA + ny * lut.sinA));
          const sf = Math.max(0, Math.min(RIM_S_BINS - 1e-4, Math.max(0, s) * invBezelS));
          const df = Math.max(0, Math.min(RIM_D_BINS - 1e-4, (dot + 1) * halfDBins));
          const si = sf | 0;
          const di = df | 0;
          const ts = sf - si;
          const td = df - di;
          const k00 = si * lutStride + di;
          const k10 = k00 + lutStride;
          const h0 = lut.hA[k00] + (lut.hA[k00 + 1] - lut.hA[k00]) * td;
          const h1 = lut.hA[k10] + (lut.hA[k10 + 1] - lut.hA[k10]) * td;
          const s0 = lut.sA[k00] + (lut.sA[k00 + 1] - lut.sA[k00]) * td;
          const s1 = lut.sA[k10] + (lut.sA[k10 + 1] - lut.sA[k10]) * td;
          const hA = (h0 + (h1 - h0) * ts) * saddleDamp;
          const sA = (s0 + (s1 - s0) * ts) * saddleDamp;
          const rimA = hA + sA * (1 - hA);
          if (rimA > 1e-5) {
            const wh = hA;
            const ws = sA * (1 - hA);
            const sumW = wh + ws;
            const lR = (hiRgb.r * wh + shRgb.r * ws) / sumW;
            const lG = (hiRgb.g * wh + shRgb.g * ws) / sumW;
            const lB = (hiRgb.b * wh + shRgb.b * ws) / sumW;
            const outA = rimA + alpha * (1 - rimA);
            r = (lR * rimA + r * alpha * (1 - rimA)) / outA;
            g = (lG * rimA + g * alpha * (1 - rimA)) / outA;
            b = (lB * rimA + b * alpha * (1 - rimA)) / outA;
            alpha = outA;
          }
        }
      }

      // 1px edge ring (matches the .lgw-glass-surface border)
      if (borderWidth > 0 && edgeAlpha > 0.005 && s - halfPx < borderWidth) {
        const overlap =
          Math.max(0, Math.min(borderWidth, s + halfPx) - Math.max(0, s - halfPx)) / pixel;
        const eA = edgeAlpha * overlap;
        if (eA > 1e-5) {
          const outA = eA + alpha * (1 - eA);
          r = (edgeRgb.r * eA + r * alpha * (1 - eA)) / outA;
          g = (edgeRgb.g * eA + g * alpha * (1 - eA)) / outA;
          b = (edgeRgb.b * eA + b * alpha * (1 - eA)) / outA;
          alpha = outA;
        }
      }

      data[idx] = Math.round(r);
      data[idx + 1] = Math.round(g);
      data[idx + 2] = Math.round(b);
      data[idx + 3] = Math.round(255 * clamp01(alpha * coverage));
    }
  }

  return { width: pw, height: ph, data };
}
