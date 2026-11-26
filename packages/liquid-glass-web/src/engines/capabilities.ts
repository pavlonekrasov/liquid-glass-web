/* ===========================================================================
   4-Tier Engine Capability Detection & Automatic Progressive Enhancement
     Tier 0: html-in-canvas (Chrome 157+ <canvas content="drawable"> WebGL2)
     Tier 1: svg-backdrop   (Chromium backdrop-filter: url(#...))
     Tier 2: svg-content    (Safari / Firefox Aave filter: url(#...) content-path)
     Tier 3: frost          (Reduced-transparency / high-contrast / forced-colors DOM)
   =========================================================================== */

import type { GlassEnginePreference } from "../core/presets.ts";

export type ResolvedGlassTier = "html-in-canvas" | "svg-backdrop" | "svg-content" | "frost";

export interface GlassCapabilities {
  readonly htmlInCanvasWebGL: boolean;
  readonly chromiumSvgBackdrop: boolean;
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
  readonly moreContrast: boolean;
  readonly forcedColors: boolean;
}

/**
 * Inline pre-hydration script string for SSR apps (<head>) to stamp [data-lg-refract]
 * before first paint on Chromium engines so Tier 1 masks never flash during hydration.
 */
export const CHROMIUM_REFRACT_INIT_SCRIPT =
  "if(typeof navigator!=='undefined'&&navigator.userAgentData)document.documentElement.setAttribute('data-lg-refract','')";

/** Feature-detects native Chrome 157+ HTML-in-Canvas + WebGL2 texture upload support. */
export function supportsHtmlInCanvasWebGL(): boolean {
  if (typeof window === "undefined" || typeof HTMLCanvasElement === "undefined") return false;
  if (typeof WebGL2RenderingContext === "undefined") return false;
  const cProto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const glProto = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
  return (
    typeof cProto.requestPaint === "function" &&
    typeof cProto.updateElementGeometry === "function" &&
    typeof cProto.getElementImageDefaultSize === "function" &&
    typeof glProto.texElementSubImage2D === "function"
  );
}

/** Detects Chromium's SVG backdrop-filter support and stamps [data-lg-refract] if absent. */
export function detectChromiumSvgBackdrop(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const hasFlag = document.documentElement.hasAttribute("data-lg-refract");
  if (hasFlag) return true;
  const nav = navigator as Navigator & { userAgentData?: unknown };
  if (nav.userAgentData) {
    document.documentElement.setAttribute("data-lg-refract", "");
    return true;
  }
  return false;
}

export function readGlassCapabilities(): GlassCapabilities {
  if (typeof window === "undefined") {
    return {
      htmlInCanvasWebGL: false,
      chromiumSvgBackdrop: false,
      reducedMotion: false,
      reducedTransparency: false,
      moreContrast: false,
      forcedColors: false,
    };
  }
  return {
    htmlInCanvasWebGL: supportsHtmlInCanvasWebGL(),
    chromiumSvgBackdrop: detectChromiumSvgBackdrop(),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    reducedTransparency: window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
    moreContrast: window.matchMedia("(prefers-contrast: more)").matches,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
  };
}

/** Resolves the active optical tier given user preference, browser capabilities, and a11y flags. */
export function resolveEngineTier(
  preference: GlassEnginePreference,
  capabilities: GlassCapabilities,
  hicFailed = false,
): ResolvedGlassTier {
  if (capabilities.reducedTransparency || capabilities.moreContrast || capabilities.forcedColors) {
    return "frost";
  }

  const canHic = capabilities.htmlInCanvasWebGL && !hicFailed;
  const canBackdrop = capabilities.chromiumSvgBackdrop;

  if (preference === "frost") return "frost";
  if (preference === "svg-content") return "svg-content";
  if (preference === "svg-backdrop") return canBackdrop ? "svg-backdrop" : "svg-content";
  if (preference === "html-in-canvas") {
    if (canHic) return "html-in-canvas";
    return canBackdrop ? "svg-backdrop" : "svg-content";
  }

  // "auto" — progressive enhancement Tier 0 -> Tier 1 -> Tier 2
  if (canHic) return "html-in-canvas";
  if (canBackdrop) return "svg-backdrop";
  return "svg-content";
}
