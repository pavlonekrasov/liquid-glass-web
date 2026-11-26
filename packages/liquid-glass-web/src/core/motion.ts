/* ===========================================================================
   Apple HIG Liquid Glass Motion & Physics Engine (pure math, zero DOM).
   Encodes SwiftUI Spring(duration:bounce:) converted analytically into
   { type: "spring", stiffness, damping, mass: 1 }.

   CRITICAL MOTION/REACT RULE:
   Never emit `duration` or `bounce` keys on the returned spring object!
   motion/react interprets `duration` as total settling time, ignores
   stiffness/damping, and collapses springs into an instant ~50 ms snap.
   =========================================================================== */

export interface GlassSpringConfig {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export interface GlassDeformationProfile {
  /** Tactile active press compression scale (e.g. 0.945 for small thumb, 0.988 for wide bar). */
  readonly pressScale: number;
  /** Maximum travel-axis stretch ratio (always strictly < 0.10 restraint ceiling). */
  readonly maxVelocityStretch: number;
  /** Cross-axis volume conservation ratio (stretchY = 1 - stretch * crossAxisRatio). */
  readonly crossAxisRatio: number;
  /** Snell optical thickness compression gain on press (1.0 when disabled). */
  readonly pressOpticalGain: number;
  /** Gaussian radius (CSS px) of internal .interactive() touch illumination bloom. */
  readonly touchGlowRadius: number;
}

export type InteractionSource = "pointer" | "keyboard" | "programmatic";
export type GlassTransitionMode = "instant" | "snappy-no-loupe" | "full-liquid";

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Converts Apple SwiftUI Spring(duration:bounce:) perceptual response period
 * into exact physical damped harmonic oscillator parameters { stiffness, damping, mass: 1 }.
 * Intentionally omits `duration` and `bounce` keys so motion/react honors physical springs.
 */
export function springFromDurationBounce(responseSec: number, bounce = 0): GlassSpringConfig {
  const response = Math.max(0.08, Math.min(1.5, responseSec));
  const clampedBounce = Math.max(-0.35, Math.min(0.45, bounce));
  const omega0 = (2 * Math.PI) / response;
  const zeta = clampedBounce >= 0 ? 1 - clampedBounce : 1 / (1 + clampedBounce);
  const stiffness = omega0 * omega0;
  const damping = 2 * zeta * omega0;
  return {
    type: "spring",
    stiffness: Number(stiffness.toFixed(2)),
    damping: Number(damping.toFixed(2)),
    mass: 1,
  };
}

/** Computes analytical damping ratio zeta = c / (2 * sqrt(k * m)). */
export function springDampingRatio(spring: {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
}): number {
  const m = spring.mass ?? 1;
  return spring.damping / (2 * Math.sqrt(spring.stiffness * m));
}

/** Semantic Apple HIG Liquid Glass spring presets (200-480 ms fluid settle). */
export const GLASS_SPRINGS = {
  /** Press compression, hover release, and touch bloom (response 0.22s, critically damped). */
  micro: springFromDurationBounce(0.22, 0.0),
  /** Critically damped tap switches, UISwitch toggles, and slider detents (response 0.36s, zeta = 1.0). */
  snappy: springFromDurationBounce(0.36, 0.0),
  /** Gesture-driven drag release with momentum handoff (response 0.42s, earned bounce 0.14). */
  interactive: springFromDurationBounce(0.42, 0.14),
  /** Elastic loupe surface-tension lift swelling on press/scrub (response 0.34s, bounce 0.18). */
  loupeLift: springFromDurationBounce(0.34, 0.18),
  /** Decisive contraction settling lifted loupe cleanly to rest (response 0.38s, bounce 0.08). */
  loupeSettle: springFromDurationBounce(0.38, 0.08),
  /** GlassEffectContainer liquid smin meniscus fusion & separation (response 0.48s, bounce 0.10). */
  morph: springFromDurationBounce(0.48, 0.1),
} as const;

/** Apple Fluid Interfaces physical gesture constants. */
export const GLASS_PHYSICS = {
  rubberbandCoeff: 0.36,
  tabRubberbandDim: 10,
  controlRubberbandDim: 10,
  flickDeceleration: 0.985,
  maxReleaseVelocity: 1800,
  pressOpticalGain: 1.12,
  sminMergeRadiusPx: 22,
} as const;

/**
 * Size-proportional liquid deformation matching WWDC 2025 Liquid Glass:
 * smaller thumbs flex more visibly while wide bars remain composed (< 10% ceiling).
 */
export function glassDeformationForSize(
  widthPx: number,
  heightPx: number,
  pressCompression = true,
): GlassDeformationProfile {
  const characteristic = Math.sqrt(Math.max(1, widthPx) * Math.max(1, heightPx));
  const sizeNorm = clamp01((characteristic - 28) / (180 - 28));
  const ease = smoothstep(0, 1, sizeNorm);

  return {
    pressScale: Number((0.945 + ease * (0.988 - 0.945)).toFixed(4)),
    maxVelocityStretch: Number((0.085 - ease * (0.085 - 0.015)).toFixed(4)),
    crossAxisRatio: 0.48,
    pressOpticalGain: pressCompression ? GLASS_PHYSICS.pressOpticalGain : 1.0,
    touchGlowRadius: Number(Math.max(34, Math.min(92, characteristic * 1.15)).toFixed(1)),
  };
}

/** Apple Fluid Interfaces hyperbolic rubber-banding past drag boundaries. */
export function rubberband(
  overshootPx: number,
  dimensionPx: number = GLASS_PHYSICS.tabRubberbandDim,
  coeff: number = GLASS_PHYSICS.rubberbandCoeff,
): number {
  if (overshootPx === 0 || dimensionPx <= 0 || coeff <= 0) return 0;
  const sign = Math.sign(overshootPx);
  const mag = Math.abs(overshootPx);
  return (sign * (mag * dimensionPx * coeff)) / (dimensionPx + coeff * mag);
}

/** Apple Fluid Interfaces exponential momentum projection (CSS px). */
export function projectMomentum(
  velocityPxPerSec: number,
  decelerationRate: number = GLASS_PHYSICS.flickDeceleration,
): number {
  const decel = Math.max(0.5, Math.min(0.998, decelerationRate));
  return ((velocityPxPerSec / 1000) * decel) / (1 - decel);
}

/** Maps pointer velocity (px/ms) into bounded travel-axis stretch [0, maxStretch]. */
export function velocityStretch(velocityPxPerMs: number, maxStretch: number): number {
  if (maxStretch <= 0) return 0;
  return maxStretch * Math.tanh(Math.abs(velocityPxPerMs) * 0.72);
}

/**
 * Progress-coupled bell arc for transient tap/toggle loupe flights:
 * 0 at start (p = 0) and arrival (p = 1), peaking at 1.0 mid-flight (p = 0.5).
 */
export function tapFlightBell(progress: number, exponent = 0.85): number {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return 0;
  return Math.pow(Math.sin(Math.PI * p), exponent);
}

/** Resolves spatial motion policy respecting prefers-reduced-motion and keyboard clarity. */
export function resolveGlassTransitionMode(
  source: InteractionSource,
  reducedMotion: boolean,
): GlassTransitionMode {
  if (reducedMotion) return "instant";
  if (source === "keyboard") return "snappy-no-loupe";
  return "full-liquid";
}
