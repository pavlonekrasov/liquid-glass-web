"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { GLASS_PHYSICS } from "../core/motion.ts";
import {
  bakeBodyOverlay,
  bakeLightOverlay,
  buildDisplacementTiles,
  contentSpectralBandAlpha,
  LENS_ORDER,
  lensLayout,
  maxSpectralFactor,
  sheetScale,
  SPECTRAL_BANDS,
  spectralDelta,
  tileScale,
  type DualLightingSpec,
  type GlassOptics,
  type LensPart,
  type LensRect,
} from "../core/optics.ts";
import type { Tile } from "../core/overlay.ts";
import type { ResolvedGlassConfig } from "../core/presets.ts";
import { detectChromiumSvgBackdrop } from "./capabilities.ts";

export interface LiquidGlassDiagnostics {
  readonly engine: "html-in-canvas" | "svg-backdrop" | "svg-content" | "frost";
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly bezel: number;
  readonly dMax: number;
  readonly rawMinJacobian: number;
  readonly clampedMinJacobian: number;
  readonly foldClamped: boolean;
  readonly scale: number;
  readonly spectralSpreadPx: number;
  readonly bakeMs: number;
}

export interface UseLiquidGlassOptions {
  readonly role?: "surface" | "loupe";
  readonly scaleMultiplier?: number;
  /** Enables Tier 2 Aave cross-browser content-path `filter: url(#...-cN)` refraction. */
  readonly contentPath?: boolean;
  /** Disables SVG refraction filter while keeping seam-free Fresnel + Beer–Lambert overlays. */
  readonly frostOnly?: boolean;
  readonly blurOverride?: number;
  readonly tintAlphaOverride?: number;
  readonly enabled?: boolean;
}

export interface UseLiquidGlassHandle {
  readonly diag: LiquidGlassDiagnostics | null;
  readonly setLiveScale: (multiplier: number) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const LOUPE_SATURATE = 1.03;
const LOUPE_BRIGHTNESS = 1.03;
const LOUPE_RING_BUMP = 0.04;
const LOUPE_RING_MAX = 0.2;
const REDUCED_MOTION_STRENGTH = 0.5;
const FILTER_PIPELINE_VERSION = 2;

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

function encodeTile(tile: Tile): string | null {
  sharedCanvas ??= document.createElement("canvas");
  sharedCtx ??= sharedCanvas.getContext("2d", { willReadFrequently: true });
  if (!sharedCtx) return null;
  sharedCanvas.width = tile.width;
  sharedCanvas.height = tile.height;
  sharedCtx.putImageData(
    new ImageData(new Uint8ClampedArray(tile.data), tile.width, tile.height),
    0,
    0,
  );
  return sharedCanvas.toDataURL("image/png");
}

function setAttrs(el: Element, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}

function placeRect(el: Element, rect: LensRect | null) {
  const r = rect ?? { x: 0, y: 0, width: 0, height: 0 };
  setAttrs(el, { x: r.x, y: r.y, width: r.width, height: r.height });
}

type DispersionMode = "single" | "spectral5";

interface FilterRefs {
  filter: SVGFilterElement;
  parts: Record<LensPart, SVGFEImageElement>;
  singleMap: SVGFEDisplacementMapElement | null;
  bandMaps: SVGFEDisplacementMapElement[];
  dispersionMode: DispersionMode;
  transparentSafe: boolean;
  version: number;
}

/**
 * Builds either:
 * - Tier 1 Chromium 1-tap linear feDisplacementMap (100+ FPS GPU fast-path — NEVER
 *   multi-tap fan-out inside backdrop-filter: url(), which stalls Skia ~450 ms/frame!).
 * - Tier 2 Aave content-path 5-band continuous spectral SVG pipeline (`filter: url(#...-cN)`):
 *   preserves premultiplied RGB (`mA = 1`) and accumulates normalized coverage `A_avg`
 *   in parallel, recombining via `rgbOpaque - (1 - A_avg)` (0/255 error, zero dark halo).
 */
function buildFilterNode(
  id: string,
  dispersionMode: DispersionMode,
  transparentSafe: boolean,
): FilterRefs {
  const filter = document.createElementNS(SVG_NS, "filter");
  setAttrs(filter, {
    id,
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const parts = {} as Record<LensPart, SVGFEImageElement>;
  const merge = document.createElementNS(SVG_NS, "feMerge");
  merge.setAttribute("result", "map");
  for (const name of LENS_ORDER) {
    const image = document.createElementNS(SVG_NS, "feImage");
    setAttrs(image, { preserveAspectRatio: "none", result: name });
    filter.append(image);
    parts[name] = image;
    const node = document.createElementNS(SVG_NS, "feMergeNode");
    node.setAttribute("in", name);
    merge.append(node);
  }
  filter.append(merge);

  if (dispersionMode === "single") {
    const singleMap = document.createElementNS(SVG_NS, "feDisplacementMap");
    setAttrs(singleMap, {
      in: "SourceGraphic",
      in2: "map",
      scale: 0,
      xChannelSelector: "R",
      yChannelSelector: "G",
    });
    filter.append(singleMap);
    return {
      filter,
      parts,
      singleMap,
      bandMaps: [],
      dispersionMode,
      transparentSafe,
      version: FILTER_PIPELINE_VERSION,
    };
  }

  const bandMaps: SVGFEDisplacementMapElement[] = [];
  let accumResult = "";
  let alphaAccumResult = "";

  for (let i = 0; i < SPECTRAL_BANDS.length; i++) {
    const band = SPECTRAL_BANDS[i];
    const dispId = `d_${band.id}`;
    const colId = `c_${band.id}`;

    const disp = document.createElementNS(SVG_NS, "feDisplacementMap");
    setAttrs(disp, {
      in: "SourceGraphic",
      in2: "map",
      scale: 0,
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: dispId,
    });
    filter.append(disp);
    bandMaps.push(disp);

    const mat = document.createElementNS(SVG_NS, "feColorMatrix");
    setAttrs(mat, {
      in: dispId,
      type: "matrix",
      values: `${band.r} 0 0 0 0  0 ${band.g} 0 0 0  0 0 ${band.b} 0 0  0 0 0 1 0`,
      result: colId,
    });
    filter.append(mat);

    if (i === 0) {
      accumResult = colId;
    } else {
      const nextResult = `acc_${i}`;
      const comp = document.createElementNS(SVG_NS, "feComposite");
      setAttrs(comp, {
        in: accumResult,
        in2: colId,
        operator: "arithmetic",
        k1: 0,
        k2: 1,
        k3: 1,
        k4: 0,
        result: nextResult,
      });
      filter.append(comp);
      accumResult = nextResult;
    }

    if (transparentSafe) {
      const alpId = `a_${band.id}`;
      const aW = contentSpectralBandAlpha(band);
      const aMat = document.createElementNS(SVG_NS, "feColorMatrix");
      setAttrs(aMat, {
        in: dispId,
        type: "matrix",
        values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${aW} 0`,
        result: alpId,
      });
      filter.append(aMat);

      if (i === 0) {
        alphaAccumResult = alpId;
      } else {
        const nextAlpha = `a_acc_${i}`;
        const aComp = document.createElementNS(SVG_NS, "feComposite");
        setAttrs(aComp, {
          in: alphaAccumResult,
          in2: alpId,
          operator: "arithmetic",
          k1: 0,
          k2: 1,
          k3: 1,
          k4: 0,
          result: nextAlpha,
        });
        filter.append(aComp);
        alphaAccumResult = nextAlpha;
      }
    }
  }

  if (!transparentSafe) {
    const alphaClamp = document.createElementNS(SVG_NS, "feColorMatrix");
    setAttrs(alphaClamp, {
      in: accumResult,
      type: "matrix",
      values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1",
    });
    filter.append(alphaClamp);
  } else {
    const blk = document.createElementNS(SVG_NS, "feFlood");
    setAttrs(blk, { "flood-color": "#000000", "flood-opacity": 1, result: "blk_pad" });
    filter.append(blk);

    const rgbOpaque = document.createElementNS(SVG_NS, "feComposite");
    setAttrs(rgbOpaque, {
      in: accumResult,
      in2: "blk_pad",
      operator: "arithmetic",
      k1: 0,
      k2: 1,
      k3: 1,
      k4: 0,
      result: "rgb_opaque",
    });
    filter.append(rgbOpaque);

    const invAlpha = document.createElementNS(SVG_NS, "feColorMatrix");
    setAttrs(invAlpha, {
      in: alphaAccumResult,
      type: "matrix",
      values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1 1",
      result: "inv_alpha",
    });
    filter.append(invAlpha);

    const finalComp = document.createElementNS(SVG_NS, "feComposite");
    setAttrs(finalComp, {
      in: "rgb_opaque",
      in2: "inv_alpha",
      operator: "arithmetic",
      k1: 0,
      k2: 1,
      k3: -1,
      k4: 0,
    });
    filter.append(finalComp);
  }

  return {
    filter,
    parts,
    singleMap: null,
    bandMaps,
    dispersionMode,
    transparentSafe,
    version: FILTER_PIPELINE_VERSION,
  };
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Low-level React hook baking seam-free Fresnel lighting, Beer–Lambert body absorption,
 * and fold-free 9-slice Snell refraction filters for Tier 1 (Chromium SVG Backdrop) and
 * Tier 2 (Safari/Firefox Aave Content-Path). Disabled cleanly when Tier 0 WebGL2 is active.
 */
export function useLiquidGlass(
  elRef: RefObject<HTMLElement | null>,
  svgHostRef: RefObject<SVGSVGElement | null>,
  config: ResolvedGlassConfig,
  options?: UseLiquidGlassOptions,
): UseLiquidGlassHandle {
  const role = options?.role ?? "surface";
  const scaleMultiplier = options?.scaleMultiplier ?? 1;
  const contentPath = options?.contentPath ?? false;
  const frostOnly = options?.frostOnly ?? false;
  const blurOverride = options?.blurOverride;
  const tintAlphaOverride = options?.tintAlphaOverride;
  const enabled = options?.enabled ?? true;

  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const moreContrast = useMediaQuery("(prefers-contrast: more)");

  const rawId = useId();
  const filterId = useMemo(
    () => `lgw-${role}-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId, role],
  );

  const [size, setSize] = useState<{ width: number; height: number; radius: number }>({
    width: 0,
    height: 0,
    radius: 999,
  });
  const [dpr, setDpr] = useState(1);
  const [diag, setDiag] = useState<LiquidGlassDiagnostics | null>(null);

  const filterRef = useRef<FilterRefs | null>(null);
  const contentVerRef = useRef(0);
  const dMaxRef = useRef(0);
  const liveParamsRef = useRef({ activeStrength: 1, activeDispersion: 0 });

  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;

    const measure = () => {
      const cs = getComputedStyle(el);
      const firstR = cs.borderTopLeftRadius.trim().split(/\s+/)[0] ?? "0";
      const parsedR = Number.parseFloat(firstR);
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const radius = Number.isFinite(parsedR)
        ? firstR.endsWith("%")
          ? (parsedR / 100) * width
          : parsedR
        : 0;
      setSize((prev) =>
        Math.abs(prev.width - width) < 0.25 &&
        Math.abs(prev.height - height) < 0.25 &&
        Math.abs(prev.radius - radius) < 0.25
          ? prev
          : { width, height, radius },
      );
      setDpr(window.devicePixelRatio || 1);
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el, { box: "border-box" });
    measure();

    const onResize = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [elRef, enabled]);

  const activeBezel = role === "loupe" ? config.loupeBezel : config.bezel;
  const activeThickness = role === "loupe" ? config.loupeThickness : config.thickness;
  const rawStrength = role === "loupe" ? config.loupeStrength : config.strength;
  const activeStrength = moreContrast
    ? 0
    : reducedMotion
      ? rawStrength * REDUCED_MOTION_STRENGTH
      : rawStrength;
  const activeDispersion = moreContrast
    ? 0
    : role === "loupe"
      ? config.loupeDispersion
      : config.dispersion;
  const activeBlur = blurOverride ?? config.blur;
  const activeTintAlpha = tintAlphaOverride ?? config.tintAlpha;
  const edgeAlpha =
    role === "loupe" && config.edgeRingAlpha > 0.005
      ? Math.min(LOUPE_RING_MAX, config.edgeRingAlpha + LOUPE_RING_BUMP)
      : config.edgeRingAlpha;
  const borderWidth = edgeAlpha > 0.005 ? 1 : 0;

  const applyFilterScale = useCallback((s: number, dispersion: number) => {
    const f = filterRef.current;
    if (!f) return;
    const delta = spectralDelta(dispersion);
    const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
    if (f.dispersionMode === "single" && f.singleMap) {
      f.singleMap.setAttribute("scale", fmt(s));
    } else {
      for (let i = 0; i < f.bandMaps.length; i++) {
        const factor = 1 + SPECTRAL_BANDS[i].offset * delta;
        f.bandMaps[i].setAttribute("scale", fmt(s * factor));
      }
    }
  }, []);

  const setLiveScale = useCallback(
    (multiplier: number) => {
      const clamped = Math.max(0, Math.min(GLASS_PHYSICS.pressOpticalGain, multiplier));
      const { activeStrength: str, activeDispersion: disp } = liveParamsRef.current;
      applyFilterScale(2 * dMaxRef.current * Math.max(0, str) * clamped, disp);
    },
    [applyFilterScale],
  );

  // Bake light, tint, and 9-slice Snell tiles strictly on geometry/config changes (0 bakes during gestures)
  useEffect(() => {
    const el = elRef.current;
    const host = svgHostRef.current;
    if (!el || !enabled || size.width <= 0 || size.height <= 0) return;

    liveParamsRef.current = { activeStrength, activeDispersion };
    const t0 = performance.now();
    const isChromium = detectChromiumSvgBackdrop();
    const asAlpha = isChromium;

    const outerRadius = Math.min(size.radius, size.width / 2, size.height / 2);
    if (outerRadius < 2) return;
    const innerRadius = Math.max(2, outerRadius - borderWidth);

    const blueFactor = activeDispersion > 0.01 ? maxSpectralFactor(activeDispersion) : 1;
    const worstMultiplier =
      Math.max(1, activeStrength) *
      (config.pressCompression && !reducedMotion ? GLASS_PHYSICS.pressOpticalGain : 1) *
      blueFactor;

    const optics: GlassOptics = {
      bezel: Math.min(activeBezel, outerRadius),
      thickness: activeThickness,
      ior: config.ior,
      profile: config.profile,
      minJacobian: config.minJacobian,
      maxMultiplier: worstMultiplier,
    };

    const lightSpec: DualLightingSpec = {
      angleDeg: config.lightAngleDeg,
      lift: config.lightLift,
      exponent: config.lightExponent,
      backBounce: config.backBounce,
      highlight: config.highlightColor,
      shade: config.shadeColor,
    };
    const isOpaqueSheet = activeTintAlpha > 0.5;
    const lightRadius = isOpaqueSheet ? innerRadius : outerRadius;
    const lightOverlayInset = isOpaqueSheet ? borderWidth : 0;

    const bakedLight = bakeLightOverlay(
      lightRadius,
      lightOverlayInset,
      optics,
      lightSpec,
      sheetScale(dpr),
      asAlpha,
      encodeTile,
    );
    if (bakedLight) {
      el.style.setProperty("--lgw-light-mask", `url("${bakedLight.mask}")`);
      el.style.setProperty("--lgw-light-color", `url("${bakedLight.color}")`);
      el.style.setProperty("--lgw-light-inset", `${borderWidth}px`);
      el.setAttribute("data-lgw-lit", "");
    }

    const bakedBody = bakeBodyOverlay(
      innerRadius,
      borderWidth,
      optics,
      activeTintAlpha,
      config.rimAlphaMin,
      sheetScale(dpr),
      asAlpha,
      encodeTile,
    );
    if (bakedBody) {
      el.style.setProperty("--lgw-body-mask", `url("${bakedBody}")`);
      el.style.setProperty(
        "--lgw-body-color",
        `rgb(${config.tintColor.r} ${config.tintColor.g} ${config.tintColor.b})`,
      );
      el.style.setProperty("--lgw-body-inset", `${borderWidth}px`);
    }

    // Tier 1 Chromium backdrop-filter MUST use linear 1-tap feDisplacementMap (100+ FPS fast-path).
    // Tier 2 Aave content-path runs full 5-band continuous spectral dispersion (~60 FPS).
    const useBackdropUrl = !frostOnly && !contentPath && isChromium;
    const useContentFilter = !frostOnly && contentPath;
    const dispersionMode: DispersionMode =
      useContentFilter && activeDispersion > 0.01 ? "spectral5" : "single";
    const buildSvgLens = (useBackdropUrl || useContentFilter) && !!host;

    let dMax = 0;
    let rawMinJacobian = 1;
    let clampedMinJacobian = 1;
    let folded = false;
    let activeFilterId = filterId;

    if (buildSvgLens && host) {
      if (useContentFilter) {
        contentVerRef.current += 1;
        activeFilterId = `${filterId}-c${contentVerRef.current}`;
      }

      if (
        !filterRef.current ||
        filterRef.current.dispersionMode !== dispersionMode ||
        filterRef.current.transparentSafe !== useContentFilter ||
        filterRef.current.version !== FILTER_PIPELINE_VERSION
      ) {
        filterRef.current?.filter.remove();
        const built = buildFilterNode(activeFilterId, dispersionMode, useContentFilter);
        host.append(built.filter);
        filterRef.current = built;
      } else if (useContentFilter) {
        filterRef.current.filter.setAttribute("id", activeFilterId);
      }

      const f = filterRef.current;
      const res = buildDisplacementTiles(outerRadius, optics, tileScale(dpr));
      dMax = res.dMax;
      rawMinJacobian = res.rawMinJacobian;
      clampedMinJacobian = res.clampedMinJacobian;
      folded = res.folded;

      const sources: Record<LensPart, Tile> = {
        neutral: res.neutral,
        ...res.edges,
        ...res.corners,
      };
      for (const part of LENS_ORDER) {
        const url = encodeTile(sources[part]);
        if (url) f.parts[part].setAttribute("href", url);
      }

      const layout = lensLayout(size.width, size.height, outerRadius, optics.bezel);
      placeRect(f.filter, layout.region);
      placeRect(f.parts.neutral, layout.neutral);
      for (const [side, rect] of Object.entries(layout.edges)) {
        placeRect(f.parts[side as LensPart], rect);
      }
      for (const [corner, rect] of Object.entries(layout.corners)) {
        placeRect(f.parts[corner as LensPart], rect);
      }

      dMaxRef.current = dMax;
      // Set static scale once on geometry/config bake (NEVER mutate per frame during springs!)
      applyFilterScale(2 * dMax * Math.max(0, activeStrength) * scaleMultiplier, activeDispersion);

      el.style.setProperty("--lgw-lens-url", `url(#${activeFilterId})`);
      if (useContentFilter) {
        el.style.setProperty("--lgw-content-filter", `url(#${activeFilterId})`);
      } else {
        el.style.removeProperty("--lgw-content-filter");
      }
      el.setAttribute("data-lgw-lens", "");
    } else {
      el.style.removeProperty("--lgw-content-filter");
      el.style.removeProperty("--lgw-lens-url");
      el.removeAttribute("data-lgw-lens");
    }

    const effSaturate = role === "loupe" ? LOUPE_SATURATE : config.saturate;
    const effBrightness = role === "loupe" ? LOUPE_BRIGHTNESS : config.brightness;
    const effContrast = role === "loupe" ? 1.0 : config.contrast;

    const bfParts = [
      activeBlur > 0.05 ? `blur(${activeBlur.toFixed(2)}px)` : "",
      useBackdropUrl ? `url(#${activeFilterId})` : "",
      Math.abs(effSaturate - 1) > 0.005 ? `saturate(${effSaturate.toFixed(2)})` : "",
      Math.abs(effBrightness - 1) > 0.005 ? `brightness(${effBrightness.toFixed(2)})` : "",
      Math.abs(effContrast - 1) > 0.005 ? `contrast(${effContrast.toFixed(2)})` : "",
    ].filter(Boolean);
    el.style.setProperty("--lgw-backdrop", bfParts.join(" "));

    const ringRgb = config.edgeRingLight ? "255 255 255" : "15 18 26";
    el.style.setProperty("--lgw-border-width", `${borderWidth}px`);
    el.style.setProperty("--lgw-edge-color", `rgb(${ringRgb} / ${edgeAlpha.toFixed(2)})`);
    el.style.setProperty(
      "--lgw-shadow",
      `0 1px 3px rgb(15 20 32 / ${(config.shadowAlpha * 0.55).toFixed(3)}), 0 8px 22px -6px rgb(15 20 32 / ${config.shadowAlpha.toFixed(3)})`,
    );

    const bakeMs = performance.now() - t0;
    const baseDiagScale = 2 * dMax * Math.max(0, activeStrength) * scaleMultiplier;
    const delta = spectralDelta(activeDispersion);
    const totalBandSpan =
      SPECTRAL_BANDS[SPECTRAL_BANDS.length - 1].offset - SPECTRAL_BANDS[0].offset;
    const spectralSpreadPx = dMax * Math.max(0, activeStrength) * totalBandSpan * delta;

    setDiag({
      engine: useContentFilter ? "svg-content" : useBackdropUrl ? "svg-backdrop" : "frost",
      dpr,
      width: Math.round(size.width),
      height: Math.round(size.height),
      radius: Math.round(outerRadius * 10) / 10,
      bezel: Math.round(optics.bezel * 10) / 10,
      dMax,
      rawMinJacobian,
      clampedMinJacobian,
      foldClamped: folded,
      scale: baseDiagScale,
      spectralSpreadPx,
      bakeMs,
    });
  }, [
    elRef,
    svgHostRef,
    filterId,
    enabled,
    contentPath,
    frostOnly,
    size,
    dpr,
    role,
    scaleMultiplier,
    borderWidth,
    edgeAlpha,
    activeBezel,
    activeThickness,
    activeStrength,
    activeDispersion,
    activeBlur,
    activeTintAlpha,
    reducedMotion,
    applyFilterScale,
    config.ior,
    config.profile,
    config.minJacobian,
    config.pressCompression,
    config.lightAngleDeg,
    config.lightLift,
    config.lightExponent,
    config.backBounce,
    config.highlightColor,
    config.shadeColor,
    config.rimAlphaMin,
    config.tintColor,
    config.saturate,
    config.brightness,
    config.contrast,
    config.edgeRingLight,
    config.shadowAlpha,
  ]);

  useEffect(() => {
    if (!enabled && filterRef.current) {
      filterRef.current.filter.remove();
      filterRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      filterRef.current?.filter.remove();
      filterRef.current = null;
    };
  }, []);

  return { diag, setLiveScale };
}
