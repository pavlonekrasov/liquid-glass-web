/* ===========================================================================
   Semantic Material Presets & Config Resolver (zero DOM).
   Maps everyday human-first props (`variant`, `shapeProfile`, `refraction`,
   `dispersion`, `frost`, `interactive`, `adaptiveContrast`) onto validated
   physical Liquid Glass parameters while keeping an `optics` escape hatch.
   =========================================================================== */

import { hexToRgb, type RgbColor } from "./color.ts";
import type { LegibilityPolarity } from "./legibility.ts";
import { BK7, type GlassShapeProfile, type Srgba } from "./optics.ts";

export type GlassVariant = "regular" | "clear" | "tinted";
export type GlassEnginePreference =
  | "auto"
  | "html-in-canvas"
  | "svg-backdrop"
  | "svg-content"
  | "frost";
export type GlassActivePillStyle = "refracting-loupe" | "tint" | "ink";

/** Advanced optical escape hatch for custom art direction (never required for everyday usage). */
export interface GlassOpticsOverride {
  readonly bezel?: number;
  readonly thickness?: number;
  readonly ior?: number;
  readonly minJacobian?: number;
  readonly barDispersion?: number;
  readonly loupeBezel?: number;
  readonly loupeThickness?: number;
  readonly loupeStrength?: number;
  readonly saturate?: number;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly tintColor?: string | RgbColor;
  readonly bodyOpacity?: number;
  readonly rimAlphaMin?: number;
  readonly lightAngle?: number;
  readonly lightLift?: number;
  readonly lightExponent?: number;
  readonly specular?: number;
  readonly backBounce?: number;
  readonly shadeAlpha?: number;
  readonly edgeRingAlpha?: number;
  readonly edgeRingLight?: boolean;
  readonly shadowStrength?: number;
  readonly foreground?: LegibilityPolarity;
  readonly activePill?: GlassActivePillStyle;
  readonly pressCompression?: boolean;
}

/** Human-first semantic props shared across <GlassStage>, <GlassSurface>, and components. */
export interface GlassMaterialProps {
  /** Material weight preset: "regular" (balanced), "clear" (crystal), "tinted" (high-legibility frost). */
  readonly variant?: GlassVariant;
  /** Bezel cross-section curvature: "circle" (natively fold-free), "c2squircle", or "squircle". */
  readonly shapeProfile?: GlassShapeProfile;
  /** Physical Snell refraction scale multiplier (0..1.3, default 1.0 = exact N-BK7). */
  readonly refraction?: number;
  /** Lifted-loupe spectral dispersion strength (0..1, default 0.62 -> ~1.12 px prism spread). */
  readonly dispersion?: number;
  /** Optical backdrop frost radius in CSS px (0..16). */
  readonly frost?: number;
  /** Enables .interactive() touch-point rim illumination, press compression, and velocity stretch. */
  readonly interactive?: boolean;
  /** Enables live scroll-adaptive >= 4.5:1 WCAG AA foreground polarity & seamless capsule scrim. */
  readonly adaptiveContrast?: boolean;
  /** Optional rendering engine override (defaults to automatic Tier 0 -> 1 -> 2 -> 3 selection). */
  readonly engine?: GlassEnginePreference;
  /** Optional advanced optical overrides for custom art direction. */
  readonly optics?: GlassOpticsOverride;
}

/** Complete resolved physical material configuration consumed by all 4 tiers. */
export interface ResolvedGlassConfig {
  readonly variant: GlassVariant;
  readonly profile: GlassShapeProfile;
  readonly bezel: number;
  readonly thickness: number;
  readonly ior: number;
  readonly minJacobian: number;
  readonly strength: number;
  readonly dispersion: number;

  readonly loupeBezel: number;
  readonly loupeThickness: number;
  readonly loupeStrength: number;
  readonly loupeDispersion: number;

  readonly blur: number;
  readonly saturate: number;
  readonly brightness: number;
  readonly contrast: number;

  readonly tintColor: RgbColor;
  readonly tintAlpha: number;
  readonly rimAlphaMin: number;

  readonly lightAngleDeg: number;
  readonly lightLift: number;
  readonly lightExponent: number;
  readonly backBounce: number;
  readonly highlightColor: Srgba;
  readonly shadeColor: Srgba;

  readonly edgeRingAlpha: number;
  readonly edgeRingLight: boolean;
  readonly shadowAlpha: number;

  readonly foreground: LegibilityPolarity;
  readonly activePill: GlassActivePillStyle;
  readonly interactive: boolean;
  readonly pressCompression: boolean;
  readonly adaptiveContrast: boolean;
  readonly engine: GlassEnginePreference;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validated baseline material configurations for each semantic variant (all strictly h(0)=0 & fold-free). */
export const GLASS_VARIANTS: Readonly<Record<GlassVariant, ResolvedGlassConfig>> = {
  regular: {
    variant: "regular",
    profile: "circle",
    bezel: 16,
    thickness: 22,
    ior: BK7.nd,
    minJacobian: 0.22,
    strength: 1.0,
    dispersion: 0.0,
    loupeBezel: 16,
    loupeThickness: 22,
    loupeStrength: 1.0,
    loupeDispersion: 0.62,
    blur: 1.4,
    saturate: 1.28,
    brightness: 1.02,
    contrast: 1.02,
    tintColor: { r: 14, g: 18, b: 28 },
    tintAlpha: 0.18,
    rimAlphaMin: 0.02,
    lightAngleDeg: -125,
    lightLift: 0.55,
    lightExponent: 2.2,
    backBounce: 0.55,
    highlightColor: { r: 255, g: 255, b: 255, a: 0.82 },
    shadeColor: { r: 10, g: 14, b: 24, a: 0.14 },
    edgeRingAlpha: 0.14,
    edgeRingLight: true,
    shadowAlpha: 0.13,
    foreground: "light",
    activePill: "refracting-loupe",
    interactive: true,
    pressCompression: true,
    adaptiveContrast: true,
    engine: "auto",
  },
  clear: {
    variant: "clear",
    profile: "circle",
    bezel: 16,
    thickness: 22,
    ior: BK7.nd,
    minJacobian: 0.22,
    strength: 1.0,
    dispersion: 0.0,
    loupeBezel: 16,
    loupeThickness: 22,
    loupeStrength: 1.0,
    loupeDispersion: 0.62,
    blur: 0.8,
    saturate: 1.32,
    brightness: 1.04,
    contrast: 1.02,
    tintColor: { r: 14, g: 18, b: 28 },
    tintAlpha: 0.06,
    rimAlphaMin: 0.015,
    lightAngleDeg: -120,
    lightLift: 0.55,
    lightExponent: 2.2,
    backBounce: 0.58,
    highlightColor: { r: 255, g: 255, b: 255, a: 0.84 },
    shadeColor: { r: 10, g: 12, b: 24, a: 0.12 },
    edgeRingAlpha: 0.14,
    edgeRingLight: true,
    shadowAlpha: 0.12,
    foreground: "light",
    activePill: "refracting-loupe",
    interactive: true,
    pressCompression: true,
    adaptiveContrast: true,
    engine: "auto",
  },
  tinted: {
    variant: "tinted",
    profile: "circle",
    bezel: 16,
    thickness: 22,
    ior: BK7.nd,
    minJacobian: 0.22,
    strength: 1.0,
    dispersion: 0.0,
    loupeBezel: 16,
    loupeThickness: 22,
    loupeStrength: 1.0,
    loupeDispersion: 0.46,
    blur: 6.0,
    saturate: 1.38,
    brightness: 1.02,
    contrast: 1.02,
    tintColor: { r: 250, g: 251, b: 254 },
    tintAlpha: 0.45,
    rimAlphaMin: 0.04,
    lightAngleDeg: -95,
    lightLift: 0.55,
    lightExponent: 2.2,
    backBounce: 0.48,
    highlightColor: { r: 255, g: 255, b: 255, a: 0.86 },
    shadeColor: { r: 15, g: 18, b: 26, a: 0.14 },
    edgeRingAlpha: 0.16,
    edgeRingLight: false,
    shadowAlpha: 0.09,
    foreground: "dark",
    activePill: "refracting-loupe",
    interactive: true,
    pressCompression: true,
    adaptiveContrast: true,
    engine: "auto",
  },
};

export const DEFAULT_GLASS_CONFIG: ResolvedGlassConfig = GLASS_VARIANTS.regular;

/** Resolves semantic GlassMaterialProps + optional optics overrides into a validated physical config. */
export function resolveGlassConfig(
  props?: GlassMaterialProps,
  base?: ResolvedGlassConfig,
): ResolvedGlassConfig {
  const variant = props?.variant ?? base?.variant ?? "regular";
  const seed = props?.variant && props.variant !== base?.variant ? GLASS_VARIANTS[variant] : (base ?? GLASS_VARIANTS[variant]);
  const opt = props?.optics;

  const tintColor: RgbColor =
    opt?.tintColor !== undefined
      ? typeof opt.tintColor === "string"
        ? hexToRgb(opt.tintColor, seed.tintColor)
        : opt.tintColor
      : seed.tintColor;

  const refraction =
    props?.refraction !== undefined ? clamp(props.refraction, 0, 1.3) : seed.strength;
  const interactive = props?.interactive ?? seed.interactive;
  const bezel = opt?.bezel !== undefined ? clamp(opt.bezel, 6, 28) : seed.bezel;
  const thickness = opt?.thickness !== undefined ? clamp(opt.thickness, 8, 40) : seed.thickness;

  return {
    variant,
    profile: props?.shapeProfile ?? seed.profile,
    bezel,
    thickness,
    ior: opt?.ior !== undefined ? clamp(opt.ior, 1.15, 1.85) : seed.ior,
    minJacobian: opt?.minJacobian !== undefined ? clamp(opt.minJacobian, 0.2, 0.55) : seed.minJacobian,
    strength: refraction,
    dispersion:
      opt?.barDispersion !== undefined ? clamp(opt.barDispersion, 0, 1) : seed.dispersion,

    loupeBezel: opt?.loupeBezel !== undefined ? clamp(opt.loupeBezel, 6, 28) : bezel,
    loupeThickness:
      opt?.loupeThickness !== undefined ? clamp(opt.loupeThickness, 8, 40) : thickness,
    loupeStrength:
      opt?.loupeStrength !== undefined ? clamp(opt.loupeStrength, 0, 1.3) : refraction,
    loupeDispersion:
      props?.dispersion !== undefined ? clamp(props.dispersion, 0, 1) : seed.loupeDispersion,

    blur: props?.frost !== undefined ? clamp(props.frost, 0, 16) : seed.blur,
    saturate: opt?.saturate !== undefined ? clamp(opt.saturate, 0.5, 2.0) : seed.saturate,
    brightness: opt?.brightness !== undefined ? clamp(opt.brightness, 0.6, 1.4) : seed.brightness,
    contrast: opt?.contrast !== undefined ? clamp(opt.contrast, 0.6, 1.4) : seed.contrast,

    tintColor,
    tintAlpha: opt?.bodyOpacity !== undefined ? clamp(opt.bodyOpacity, 0, 0.85) : seed.tintAlpha,
    rimAlphaMin:
      opt?.rimAlphaMin !== undefined ? clamp(opt.rimAlphaMin, 0, 0.5) : seed.rimAlphaMin,

    lightAngleDeg: opt?.lightAngle ?? seed.lightAngleDeg,
    lightLift: opt?.lightLift !== undefined ? clamp(opt.lightLift, 0.15, 1.5) : seed.lightLift,
    lightExponent:
      opt?.lightExponent !== undefined ? clamp(opt.lightExponent, 1, 6) : seed.lightExponent,
    backBounce: opt?.backBounce !== undefined ? clamp(opt.backBounce, 0, 1) : seed.backBounce,
    highlightColor:
      opt?.specular !== undefined
        ? { ...seed.highlightColor, a: clamp(opt.specular, 0, 1) }
        : seed.highlightColor,
    shadeColor:
      opt?.shadeAlpha !== undefined
        ? { ...seed.shadeColor, a: clamp(opt.shadeAlpha, 0, 0.5) }
        : seed.shadeColor,

    edgeRingAlpha:
      opt?.edgeRingAlpha !== undefined ? clamp(opt.edgeRingAlpha, 0, 0.4) : seed.edgeRingAlpha,
    edgeRingLight: opt?.edgeRingLight ?? seed.edgeRingLight,
    shadowAlpha:
      opt?.shadowStrength !== undefined ? clamp(opt.shadowStrength, 0, 0.25) : seed.shadowAlpha,

    foreground: opt?.foreground ?? seed.foreground,
    activePill: opt?.activePill ?? seed.activePill,
    interactive,
    pressCompression: opt?.pressCompression ?? (interactive ? seed.pressCompression : false),
    adaptiveContrast: props?.adaptiveContrast ?? seed.adaptiveContrast,
    engine: props?.engine ?? seed.engine,
  };
}
