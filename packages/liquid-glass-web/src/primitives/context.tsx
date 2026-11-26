"use client";

import { createContext, useContext, type RefObject } from "react";
import type { AdaptiveLegibilityResult, LegibilityPolarity } from "../core/legibility.ts";
import { DEFAULT_GLASS_CONFIG, type ResolvedGlassConfig } from "../core/presets.ts";
import type { GlassCapabilities, ResolvedGlassTier } from "../engines/capabilities.ts";
import type { HicGlassBridge } from "../engines/hicBridge.ts";

export interface GlassStageContextValue {
  readonly tier: ResolvedGlassTier;
  readonly capabilities: GlassCapabilities;
  readonly config: ResolvedGlassConfig;
  readonly svgHostRef: RefObject<SVGSVGElement | null>;
  readonly hicBridge: HicGlassBridge | null;
  readonly reducedMotion: boolean;
  readonly legibility: AdaptiveLegibilityResult | null;
  readonly effectiveFg: LegibilityPolarity;
  readonly reportLegibility: (res: AdaptiveLegibilityResult | null) => void;
  readonly registerMorphGroup: (containerId: string) => number;
  readonly requestChromePaint: () => void;
  readonly syncStageConfig: (next: ResolvedGlassConfig) => void;
  readonly layoutVersion: number;
}

const DEFAULT_CAPABILITIES: GlassCapabilities = {
  htmlInCanvasWebGL: false,
  chromiumSvgBackdrop: false,
  reducedMotion: false,
  reducedTransparency: false,
  moreContrast: false,
  forcedColors: false,
};

const FALLBACK_SVG_REF: RefObject<SVGSVGElement | null> = { current: null };

export const GlassStageContext = createContext<GlassStageContextValue>({
  tier: "frost",
  capabilities: DEFAULT_CAPABILITIES,
  config: DEFAULT_GLASS_CONFIG,
  svgHostRef: FALLBACK_SVG_REF,
  hicBridge: null,
  reducedMotion: false,
  legibility: null,
  effectiveFg: DEFAULT_GLASS_CONFIG.foreground,
  reportLegibility: () => {},
  registerMorphGroup: () => 0,
  requestChromePaint: () => {},
  syncStageConfig: () => {},
  layoutVersion: 0,
});

export interface GlassContainerContextValue {
  readonly id: string | null;
  readonly morphGroup: number;
  readonly mergeRadius: number;
}

export const GlassContainerContext = createContext<GlassContainerContextValue>({
  id: null,
  morphGroup: 0,
  mergeRadius: 0,
});

export function useGlassStage(): GlassStageContextValue {
  return useContext(GlassStageContext);
}

export function useGlassContainer(): GlassContainerContextValue {
  return useContext(GlassContainerContext);
}
