/* Springs are returned as { stiffness, damping, mass } with no `duration` or `bounce`
   key: motion treats `duration` as the total time and ignores stiffness and damping. */

export interface GlassSpringConfig {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export interface GlassDeformationProfile {
  /** Scale while pressed (e.g. 0.945 for a small thumb, 0.988 for a wide bar). */
  readonly pressScale: number;
  /** Maximum stretch along the travel axis (kept below 0.10). */
  readonly maxVelocityStretch: number;
  /** Cross-axis volume conservation ratio (stretchY = 1 - stretch * crossAxisRatio). */
  readonly crossAxisRatio: number;
  /** Refraction gain while pressed (1.0 when disabled). */
  readonly pressOpticalGain: number;
  /** Blur radius in px of the touch highlight. */
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

/** Converts SwiftUI's Spring(duration:bounce:) into stiffness and damping with mass 1. */
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

/** Spring presets (settle in roughly 200 to 480 ms). */
export const GLASS_SPRINGS = {
  /** Press, hover release and touch highlight (response 0.22s, critically damped). */
  micro: springFromDurationBounce(0.22, 0.0),
  /** Taps, switch toggles and slider detents (response 0.36s, critically damped). */
  snappy: springFromDurationBounce(0.36, 0.0),
  /** Drag release with momentum (response 0.42s, bounce 0.14). */
  interactive: springFromDurationBounce(0.42, 0.14),
  /** Loupe lift on press or scrub (response 0.34s, bounce 0.18). */
  loupeLift: springFromDurationBounce(0.34, 0.18),
  /** Loupe settling back to rest (response 0.38s, bounce 0.08). */
  loupeSettle: springFromDurationBounce(0.38, 0.08),
  /** Merging and separating inside a GlassContainer (response 0.48s, bounce 0.10). */
  morph: springFromDurationBounce(0.48, 0.1),
} as const;

export const GLASS_PHYSICS = {
  rubberbandCoeff: 0.36,
  tabRubberbandDim: 10,
  controlRubberbandDim: 10,
  flickDeceleration: 0.985,
  maxReleaseVelocity: 1800,
  pressOpticalGain: 1.12,
  sminMergeRadiusPx: 22,
} as const;

/** Stretch scaled by size: small thumbs flex more, wide bars stay steady (under 10%). */
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

/** Rubber-banding past the drag bounds. */
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

/** Projected momentum distance in px. */
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

/** Bell curve over flight progress: 0 at both ends, 1 at the midpoint. */
export function tapFlightBell(progress: number, exponent = 0.85): number {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return 0;
  return Math.pow(Math.sin(Math.PI * p), exponent);
}

/** Motion policy for prefers-reduced-motion and keyboard input. */
export function resolveGlassTransitionMode(
  source: InteractionSource,
  reducedMotion: boolean,
): GlassTransitionMode {
  if (reducedMotion) return "instant";
  if (source === "keyboard") return "snappy-no-loupe";
  return "full-liquid";
}
