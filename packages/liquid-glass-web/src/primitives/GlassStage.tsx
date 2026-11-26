"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { AdaptiveLegibilityResult } from "../core/legibility.ts";
import {
  resolveGlassConfig,
  type GlassMaterialProps,
  type ResolvedGlassConfig,
} from "../core/presets.ts";
import {
  readGlassCapabilities,
  resolveEngineTier,
  type GlassCapabilities,
  type ResolvedGlassTier,
} from "../engines/capabilities.ts";
import { createHicGlassBridge } from "../engines/hicBridge.ts";
import { HicStage } from "../engines/HicStage.tsx";
import { GlassStageContext, type GlassStageContextValue } from "./context.tsx";

const CHROME_SLOT_SYMBOL = Symbol.for("liquid-glass-web.GlassStage.Chrome");

export interface GlassStageChromeProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function GlassStageChrome({ children, className, style }: GlassStageChromeProps) {
  return (
    <div className={className ? `lgw-chrome ${className}` : "lgw-chrome"} style={style}>
      {children}
    </div>
  );
}
(GlassStageChrome as unknown as Record<symbol, boolean>)[CHROME_SLOT_SYMBOL] = true;

function isChromeSlot(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const t = node.type as unknown as Record<symbol, boolean> | undefined;
  return Boolean(t && t[CHROME_SLOT_SYMBOL]);
}

export interface GlassStageProps extends GlassMaterialProps {
  children?: ReactNode;
  /** Streams animated canvas backdrops at ~30 Hz into Tier 0 WebGL2 scene texture. */
  continuousScene?: boolean;
  /** Optional scene key triggering an immediate Tier 0 scene texture refresh when changed. */
  sceneKey?: string;
  /** Layout key notifying child Tier 0 nodes to re-measure geometry (e.g. after moving chrome). */
  layoutVersion?: number;
  /** Viewport-fixed full-bleed stage (default true) vs flow-contained stage. */
  fullscreen?: boolean;
  className?: string;
  sceneClassName?: string;
  chromeClassName?: string;
  style?: CSSProperties;
  /** Callback fired whenever the active tier (Tier 0/1/2/3) changes. */
  onTierChange?: (tier: ResolvedGlassTier) => void;
  /** Callback fired whenever scroll-adaptive WCAG AA legibility updates. */
  onLegibilityChange?: (legibility: AdaptiveLegibilityResult | null) => void;
}

function GlassStageRoot({
  children,
  variant,
  shapeProfile,
  refraction,
  dispersion,
  frost,
  interactive,
  adaptiveContrast,
  engine = "auto",
  optics,
  continuousScene = false,
  sceneKey,
  layoutVersion = 0,
  fullscreen = true,
  className,
  sceneClassName,
  chromeClassName,
  style,
  onTierChange,
  onLegibilityChange,
}: GlassStageProps) {
  const svgHostRef = useRef<SVGSVGElement>(null);
  const hicBridge = useMemo(() => createHicGlassBridge(), []);
  const morphMapRef = useRef<Map<string, number>>(new Map());

  const [capabilities, setCapabilities] = useState<GlassCapabilities>({
    htmlInCanvasWebGL: false,
    chromiumSvgBackdrop: false,
    reducedMotion: false,
    reducedTransparency: false,
    moreContrast: false,
    forcedColors: false,
  });
  const [hicFailed, setHicFailed] = useState(false);
  const [legibility, setLegibility] = useState<AdaptiveLegibilityResult | null>(null);
  const [childConfigOverride, setChildConfigOverride] = useState<ResolvedGlassConfig | null>(null);

  useEffect(() => {
    const sync = () => setCapabilities(readGlassCapabilities());
    sync();
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rt = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const hc = window.matchMedia("(prefers-contrast: more)");
    const fc = window.matchMedia("(forced-colors: active)");
    rm.addEventListener("change", sync);
    rt.addEventListener("change", sync);
    hc.addEventListener("change", sync);
    fc.addEventListener("change", sync);
    return () => {
      rm.removeEventListener("change", sync);
      rt.removeEventListener("change", sync);
      hc.removeEventListener("change", sync);
      fc.removeEventListener("change", sync);
    };
  }, []);

  const stageConfig = useMemo(
    () =>
      resolveGlassConfig({
        variant,
        shapeProfile,
        refraction,
        dispersion,
        frost,
        interactive,
        adaptiveContrast,
        engine,
        optics,
      }),
    [
      variant,
      shapeProfile,
      refraction,
      dispersion,
      frost,
      interactive,
      adaptiveContrast,
      engine,
      optics,
    ],
  );

  // Stage props take priority when explicit; otherwise allow child component config sync for Tier 0
  const hasExplicitStageStyle =
    variant !== undefined ||
    shapeProfile !== undefined ||
    refraction !== undefined ||
    dispersion !== undefined ||
    frost !== undefined ||
    optics !== undefined;

  const effectiveConfig = hasExplicitStageStyle ? stageConfig : (childConfigOverride ?? stageConfig);

  const tier = useMemo(
    () => resolveEngineTier(engine, capabilities, hicFailed),
    [engine, capabilities, hicFailed],
  );

  useEffect(() => {
    onTierChange?.(tier);
  }, [tier, onTierChange]);

  const handleFallbackNeeded = useCallback(() => {
    setHicFailed(true);
  }, []);

  const reportLegibility = useCallback(
    (next: AdaptiveLegibilityResult | null) => {
      setLegibility((prev) => {
        if (
          prev &&
          next &&
          prev.polarity === next.polarity &&
          Math.abs(prev.scrimAlpha - next.scrimAlpha) < 0.015 &&
          Math.abs(prev.worstContrast - next.worstContrast) < 0.2
        ) {
          return prev;
        }
        return next;
      });
      onLegibilityChange?.(next);
    },
    [onLegibilityChange],
  );

  const registerMorphGroup = useCallback((containerId: string): number => {
    const map = morphMapRef.current;
    const existing = map.get(containerId);
    if (existing !== undefined) return existing;
    const nextGroup = Math.min(3, map.size + 1);
    map.set(containerId, nextGroup);
    return nextGroup;
  }, []);

  const useHic = tier === "html-in-canvas";
  const activeBridge = useHic ? hicBridge : null;

  const requestChromePaint = useCallback(() => {
    activeBridge?.requestPaint();
  }, [activeBridge]);

  const syncStageConfig = useCallback((next: ResolvedGlassConfig) => {
    setChildConfigOverride((prev) => (prev === next ? prev : next));
  }, []);

  const effectiveFg =
    effectiveConfig.adaptiveContrast && legibility
      ? legibility.polarity
      : effectiveConfig.foreground;

  useEffect(() => {
    if (!activeBridge) return;
    activeBridge.updateLegibility(
      effectiveFg === "dark",
      effectiveConfig.adaptiveContrast,
      legibility ? legibility.scrimRgb : [12, 16, 26],
      legibility ? legibility.scrimAlpha : 0,
    );
    activeBridge.requestPaint();
  }, [activeBridge, effectiveFg, effectiveConfig.adaptiveContrast, legibility]);

  const { sceneNodes, chromeNodes } = useMemo(() => {
    const sNodes: ReactNode[] = [];
    const cNodes: ReactNode[] = [];
    for (const child of Children.toArray(children)) {
      if (isChromeSlot(child)) cNodes.push(child);
      else sNodes.push(child);
    }
    return { sceneNodes: sNodes, chromeNodes: cNodes };
  }, [children]);

  const ctxValue = useMemo<GlassStageContextValue>(
    () => ({
      tier,
      capabilities,
      config: effectiveConfig,
      svgHostRef,
      hicBridge: activeBridge,
      reducedMotion: capabilities.reducedMotion,
      legibility,
      effectiveFg,
      reportLegibility,
      registerMorphGroup,
      requestChromePaint,
      syncStageConfig,
      layoutVersion,
    }),
    [
      tier,
      capabilities,
      effectiveConfig,
      activeBridge,
      legibility,
      effectiveFg,
      reportLegibility,
      registerMorphGroup,
      requestChromePaint,
      syncStageConfig,
      layoutVersion,
    ],
  );

  const stageAttrs = {
    "data-lgw-tier": tier,
    "data-fg": effectiveFg,
    "data-adaptive-a11y": effectiveConfig.adaptiveContrast ? "true" : "false",
    "data-hic-webgl": useHic ? "true" : "false",
  };

  return (
    <GlassStageContext.Provider value={ctxValue}>
      <div
        className={`lgw-stage${fullscreen ? " lgw-stage--fullscreen" : ""}${className ? ` ${className}` : ""}`}
        style={style}
        {...stageAttrs}
      >
        <svg ref={svgHostRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />

        {useHic ? (
          <HicStage
            config={effectiveConfig}
            bridge={hicBridge}
            continuousScene={continuousScene}
            sceneKey={sceneKey}
            sceneClassName={sceneClassName}
            chromeClassName={chromeClassName}
            onFallbackNeeded={handleFallbackNeeded}
            sceneChildren={sceneNodes}
            chromeChildren={chromeNodes}
          />
        ) : (
          <>
            <div
              className={sceneClassName ? `lgw-scene ${sceneClassName}` : "lgw-scene"}
              data-lgw-scroll-container="true"
            >
              {sceneNodes}
            </div>
            {chromeNodes}
          </>
        )}
      </div>
    </GlassStageContext.Provider>
  );
}

export const GlassStage = Object.assign(GlassStageRoot, {
  Chrome: GlassStageChrome,
});
