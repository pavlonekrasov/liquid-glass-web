/* Mutable registry the Tier 0 renderer reads every frame, so animating components don't re-render React. */

import { MAX_HIC_LOUPES, MAX_HIC_SURFACES } from "../core/hicShaders.ts";

export { MAX_HIC_LOUPES, MAX_HIC_SURFACES };

export type HicSurfaceKind = "glass" | "switch-track" | "slider-track";

export interface HicGlassSurfaceNode {
  readonly kind: HicSurfaceKind;
  /** Center X/Y and border-box size in viewport CSS px. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  /** GlassContainer group (0 = none, 1..3 = merges with the group). */
  readonly morphGroup?: number;
  /** Merge radius in px. */
  readonly mergeK?: number;
  /** Whether the surface gets the legibility scrim. */
  readonly applyScrim?: boolean;
  /** Resting selection pill (tab bar). */
  readonly pillCx?: number;
  readonly pillCy?: number;
  readonly pillW?: number;
  readonly pillH?: number;
  readonly pillAlpha?: number;
  /** Track fill (0..1) for switches and sliders. */
  readonly fill?: number;
  /** Resting thumb (switch, slider). */
  readonly knobCx?: number;
  readonly knobW?: number;
  readonly knobH?: number;
  readonly knobScaleX?: number;
  readonly knobScaleY?: number;
  readonly knobAlpha?: number;
  /** Touch highlight position in viewport px. */
  readonly touchX?: number;
  readonly touchY?: number;
  readonly touchGlow?: number;
  readonly touchRadius?: number;
}

export interface HicGlassLoupeNode {
  readonly cx: number;
  readonly cy: number;
  readonly nativeW: number;
  readonly nativeH: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly alpha: number;
  readonly pressGain: number;
  readonly bezel?: number;
  readonly thickness?: number;
  readonly dispersionScale?: number;
  readonly tintAlpha?: number;
  readonly ringAlpha?: number;
  readonly touchX?: number;
  readonly touchY?: number;
  readonly touchGlow?: number;
  readonly touchRadius?: number;
}

export interface HicLegibilityState {
  fgDark: boolean;
  adaptiveA11y: boolean;
  scrimRgb: readonly [number, number, number];
  scrimAlpha: number;
}

export interface HicGlassBridge {
  readonly legibility: Readonly<HicLegibilityState>;
  upsertSurface: (id: string, node: HicGlassSurfaceNode) => void;
  removeSurface: (id: string) => void;
  upsertLoupe: (id: string, node: HicGlassLoupeNode) => void;
  removeLoupe: (id: string) => void;
  updateLegibility: (
    fgDark: boolean,
    adaptiveA11y: boolean,
    scrimRgb: readonly [number, number, number],
    scrimAlpha: number,
  ) => void;
  getSurfaces: () => readonly HicGlassSurfaceNode[];
  getLoupes: () => readonly HicGlassLoupeNode[];
  requestDraw: () => void;
  requestPaint: () => void;
  bind: (draw: () => void, paint: () => void) => () => void;
}

export function createHicGlassBridge(): HicGlassBridge {
  let drawCb: (() => void) | null = null;
  let paintCb: (() => void) | null = null;

  const surfaces = new Map<string, HicGlassSurfaceNode>();
  const loupes = new Map<string, HicGlassLoupeNode>();

  const legibility: HicLegibilityState = {
    fgDark: false,
    adaptiveA11y: true,
    scrimRgb: [12, 16, 26],
    scrimAlpha: 0,
  };

  return {
    legibility,
    upsertSurface(id, node) {
      surfaces.set(id, node);
      drawCb?.();
    },
    removeSurface(id) {
      if (surfaces.delete(id)) {
        drawCb?.();
      }
    },
    upsertLoupe(id, node) {
      loupes.set(id, node);
      drawCb?.();
    },
    removeLoupe(id) {
      if (loupes.delete(id)) {
        drawCb?.();
      }
    },
    updateLegibility(fgDark, adaptiveA11y, scrimRgb, scrimAlpha) {
      legibility.fgDark = fgDark;
      legibility.adaptiveA11y = adaptiveA11y;
      legibility.scrimRgb = scrimRgb;
      legibility.scrimAlpha = scrimAlpha;
      drawCb?.();
    },
    getSurfaces() {
      return Array.from(surfaces.values()).slice(0, MAX_HIC_SURFACES);
    },
    getLoupes() {
      return Array.from(loupes.values()).slice(0, MAX_HIC_LOUPES);
    },
    requestDraw() {
      drawCb?.();
    },
    requestPaint() {
      paintCb?.();
    },
    bind(draw, paint) {
      drawCb = draw;
      paintCb = paint;
      return () => {
        if (drawCb === draw) drawCb = null;
        if (paintCb === paint) paintCb = null;
      };
    },
  };
}
