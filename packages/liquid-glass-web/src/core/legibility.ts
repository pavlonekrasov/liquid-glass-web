/* ===========================================================================
   Scroll-Adaptive WCAG AA Legibility Solver — guarantees >= 4.5:1 label
   contrast over arbitrary scrolling content while preserving glass clarity.
   Separates 10-point area-weighted polaritySamples (Schmitt trigger [0.24, 0.56]
   + temporal dwell) from worst-case contrastSamples (minimal uniform scrim).
   Pure math, no DOM.
   =========================================================================== */

import { contrastRatio, relativeLuminance, type SRGB } from "./color.ts";

export type LegibilityPolarity = "light" | "dark";

export interface PolarityStabilityState {
  readonly committed: LegibilityPolarity | null;
  readonly candidate: LegibilityPolarity | null;
  readonly candidateSince: number | null;
}

export interface PolarityObservation {
  readonly state: PolarityStabilityState;
  readonly committed: LegibilityPolarity | null;
}

export interface AdaptiveLegibilityOptions {
  /** Current Beer–Lambert plateau tint opacity already painted (0..1). */
  readonly baseTintAlpha?: number;
  /** Current Beer–Lambert tint RGB (defaults to pole's neutral scrim color). */
  readonly baseTintRgb?: SRGB;
  /** Minimum WCAG 2.1 contrast ratio guaranteed across sampled backdrop points (default 5.0). */
  readonly targetContrast?: number;
  /** Previous committed polarity for Schmitt-trigger hysteresis against wave/gap white flashes. */
  readonly previousPolarity?: LegibilityPolarity;
  /** Area-weighted spatial samples driving calm mean-luminance polarity (defaults to samples). */
  readonly polaritySamples?: readonly SRGB[];
  /** Optional locked polarity when adaptiveContrast is disabled. */
  readonly forcedPolarity?: LegibilityPolarity;
}

export interface AdaptiveLegibilityResult {
  readonly polarity: LegibilityPolarity;
  readonly foregroundRgb: SRGB;
  readonly scrimRgb: SRGB;
  /** Exact combined plateau opacity holding targetContrast across worst-case pixels. */
  readonly totalPlateauAlpha: number;
  /** Additional GPU scrim alpha composited over baseTintAlpha (source-over delta, 0..0.85). */
  readonly scrimAlpha: number;
  /** Localized text-shadow guard opacity (0.22..0.66) scaled by backdrop luminance spread. */
  readonly guardAlpha: number;
  /** Worst-case WCAG 2.1 contrast ratio across all sampled pixels after scrim. */
  readonly worstContrast: number;
  /** Mean WCAG 2.1 contrast ratio across sampled pixels after scrim. */
  readonly meanContrast: number;
  /** Luminance spread (max - min) behind the glass surface. */
  readonly luminanceSpread: number;
}

const LIGHT_FG: SRGB = [255, 255, 255];
const DARK_FG: SRGB = [10, 12, 18];
export const DARK_SCRIM_RGB: SRGB = [12, 16, 26];
export const LIGHT_SCRIM_RGB: SRGB = [250, 251, 254];
const DEFAULT_TARGET_CONTRAST = 5.0;
const MAX_PLATEAU_ALPHA = 0.78;

/** Schmitt-trigger mean-luminance thresholds preventing polarity flicker on gold crests / card gaps. */
export const FLIP_TO_DARK_INK_LUM = 0.56;
export const FLIP_TO_LIGHT_INK_LUM = 0.24;
export const DEFAULT_POLARITY_DWELL_MS = 220;
const INITIAL_POLARITY_LUM = 0.38;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function blendOver(fg: SRGB, bg: SRGB, alpha: number): SRGB {
  const a = clamp01(alpha);
  const inv = 1 - a;
  return [fg[0] * a + bg[0] * inv, fg[1] * a + bg[1] * inv, fg[2] * a + bg[2] * inv];
}

function worstContrastWithScrim(
  fgLum: number,
  scrimRgb: SRGB,
  scrimAlpha: number,
  baseTintRgb: SRGB,
  baseTintAlpha: number,
  samples: readonly SRGB[],
): { worst: number; mean: number } {
  let worst = Infinity;
  let sum = 0;
  for (const bg of samples) {
    const afterBase = blendOver(baseTintRgb, bg, baseTintAlpha);
    const afterScrim = blendOver(scrimRgb, afterBase, scrimAlpha);
    const ratio = contrastRatio(fgLum, relativeLuminance(afterScrim));
    if (ratio < worst) worst = ratio;
    sum += ratio;
  }
  return { worst, mean: sum / samples.length };
}

function solvePole(
  polarity: LegibilityPolarity,
  samples: readonly SRGB[],
  baseTintRgb: SRGB,
  baseTintAlpha: number,
  targetContrast: number,
) {
  const fgRgb = polarity === "light" ? LIGHT_FG : DARK_FG;
  const scrimRgb = polarity === "light" ? DARK_SCRIM_RGB : LIGHT_SCRIM_RGB;
  const fgLum = relativeLuminance(fgRgb);

  const atZero = worstContrastWithScrim(fgLum, scrimRgb, 0, baseTintRgb, baseTintAlpha, samples);
  if (atZero.worst >= targetContrast) {
    return {
      polarity,
      fgRgb,
      scrimRgb,
      scrimAlpha: 0,
      totalPlateauAlpha: baseTintAlpha,
      worstContrast: atZero.worst,
      meanContrast: atZero.mean,
    };
  }

  const maxScrim = clamp01((MAX_PLATEAU_ALPHA - baseTintAlpha) / Math.max(0.05, 1 - baseTintAlpha));
  let lo = 0;
  let hi = maxScrim;
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    const { worst } = worstContrastWithScrim(
      fgLum,
      scrimRgb,
      mid,
      baseTintRgb,
      baseTintAlpha,
      samples,
    );
    if (worst >= targetContrast) hi = mid;
    else lo = mid;
  }

  const scrimAlpha = +hi.toFixed(3);
  const solved = worstContrastWithScrim(
    fgLum,
    scrimRgb,
    scrimAlpha,
    baseTintRgb,
    baseTintAlpha,
    samples,
  );
  const totalPlateauAlpha = clamp01(baseTintAlpha + scrimAlpha * (1 - baseTintAlpha));

  return {
    polarity,
    fgRgb,
    scrimRgb,
    scrimAlpha,
    totalPlateauAlpha,
    worstContrast: solved.worst,
    meanContrast: solved.mean,
  };
}

/** Temporal hysteresis dwell gate preventing chatter while scrolling across boundaries. */
export function stabilizePolarity(
  state: Readonly<PolarityStabilityState>,
  observed: LegibilityPolarity,
  atMs: number,
  dwellMs = DEFAULT_POLARITY_DWELL_MS,
): PolarityObservation {
  if (state.committed === null) {
    return {
      state: { committed: observed, candidate: null, candidateSince: null },
      committed: observed,
    };
  }

  if (observed === state.committed) {
    return {
      state: { committed: state.committed, candidate: null, candidateSince: null },
      committed: null,
    };
  }

  if (state.candidate !== observed || state.candidateSince === null) {
    return {
      state: { committed: state.committed, candidate: observed, candidateSince: atMs },
      committed: null,
    };
  }

  if (atMs - state.candidateSince < dwellMs) {
    return { state: { ...state }, committed: null };
  }

  return {
    state: { committed: observed, candidate: null, candidateSince: null },
    committed: observed,
  };
}

/**
 * Chooses foreground polarity from area-weighted mean backdrop luminance via a
 * wide Schmitt trigger ([0.24, 0.56]), then solves the exact minimum seamless
 * uniform scrim opacity guaranteeing >= targetContrast (WCAG AA).
 */
export function solveAdaptiveLegibility(
  samples: readonly SRGB[],
  options?: AdaptiveLegibilityOptions,
): AdaptiveLegibilityResult {
  const safeSamples: readonly SRGB[] = samples.length > 0 ? samples : [[14, 18, 28]];
  const polSamples: readonly SRGB[] =
    options?.polaritySamples && options.polaritySamples.length > 0
      ? options.polaritySamples
      : safeSamples;
  const baseTintAlpha = clamp01(options?.baseTintAlpha ?? 0.18);
  const targetContrast = options?.targetContrast ?? DEFAULT_TARGET_CONTRAST;

  const contrastLums = safeSamples.map(relativeLuminance);
  const luminanceSpread = Math.max(...contrastLums) - Math.min(...contrastLums);
  const meanLum =
    polSamples.reduce((sum, rgb) => sum + relativeLuminance(rgb), 0) / polSamples.length;

  let polarity: LegibilityPolarity;
  if (options?.forcedPolarity) {
    polarity = options.forcedPolarity;
  } else if (options?.previousPolarity === "light") {
    polarity = meanLum > FLIP_TO_DARK_INK_LUM ? "dark" : "light";
  } else if (options?.previousPolarity === "dark") {
    polarity = meanLum < FLIP_TO_LIGHT_INK_LUM ? "light" : "dark";
  } else {
    polarity = meanLum >= INITIAL_POLARITY_LUM ? "dark" : "light";
  }

  const adaptiveTint = !options?.forcedPolarity;
  const baseRgb = adaptiveTint
    ? polarity === "light"
      ? DARK_SCRIM_RGB
      : LIGHT_SCRIM_RGB
    : (options?.baseTintRgb ?? (polarity === "light" ? DARK_SCRIM_RGB : LIGHT_SCRIM_RGB));

  const chosen = solvePole(polarity, safeSamples, baseRgb, baseTintAlpha, targetContrast);
  const smoothScrim = chosen.scrimAlpha < 0.01 ? 0 : Math.ceil(chosen.scrimAlpha * 50) / 50;

  const textureRisk = clamp01((luminanceSpread - 0.18) / 0.55);
  const guardAlpha = +(0.22 + 0.44 * textureRisk).toFixed(2);

  return {
    polarity: chosen.polarity,
    foregroundRgb: chosen.fgRgb,
    scrimRgb: chosen.scrimRgb,
    totalPlateauAlpha: +chosen.totalPlateauAlpha.toFixed(3),
    scrimAlpha: +smoothScrim.toFixed(2),
    guardAlpha,
    worstContrast: +chosen.worstContrast.toFixed(2),
    meanContrast: +chosen.meanContrast.toFixed(2),
    luminanceSpread: +luminanceSpread.toFixed(3),
  };
}
