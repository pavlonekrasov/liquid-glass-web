"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { GLASS_PHYSICS } from "../core/motion.ts";
import {
  maxSpectralFactor,
  sheetScale,
  tileScale,
  type DualLightingSpec,
  type GlassOptics,
} from "../core/optics.ts";
import {
  bakePolySminOptics,
  buildCapsuleDisplacementMap,
  buildPolySminDisplacementMap,
  buildPolySminPath,
  type PolySminOpticsParams,
  type UnionCapsule,
} from "../core/union.ts";
import { detectChromiumSvgBackdrop } from "../engines/capabilities.ts";
import { createUnionWebGLRenderer, type UnionWebGLRenderer } from "../engines/unionWebgl.ts";
import { GlassContainerContext, useGlassStage } from "./context.tsx";

export interface GlassContainerProps {
  /** Group name (e.g. "nav"). */
  id?: string;
  /** Merge radius in px (default 22). */
  mergeRadius?: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SHADOW_PAD = 28;
const REDUCED_MOTION_STRENGTH = 0.5;

let unionEncodeCanvas: HTMLCanvasElement | null = null;
let unionEncodeCtx: CanvasRenderingContext2D | null = null;

function encodeUnionTile(width: number, height: number, data: Uint8ClampedArray): string | null {
  unionEncodeCanvas ??= document.createElement("canvas");
  unionEncodeCtx ??= unionEncodeCanvas.getContext("2d", { willReadFrequently: true });
  if (!unionEncodeCtx) return null;
  unionEncodeCanvas.width = width;
  unionEncodeCanvas.height = height;
  unionEncodeCtx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return unionEncodeCanvas.toDataURL("image/png");
}

interface MotionDispCache {
  readonly key: string;
  readonly barUrl: string;
  readonly orbUrl: string;
  readonly dMax: number;
}

/** Like SwiftUI's GlassEffectContainer: glass children inside it merge into one shape on every tier. */
export function GlassContainer({
  id,
  mergeRadius = GLASS_PHYSICS.sminMergeRadiusPx,
  children,
  className,
  style,
}: GlassContainerProps) {
  const autoId = useId();
  const safeId = useMemo(() => autoId.replace(/[^a-zA-Z0-9_-]/g, ""), [autoId]);
  const resolvedId = id ?? autoId;
  const stage = useGlassStage();
  const { registerMorphGroup } = stage;

  const containerRef = useRef<HTMLDivElement>(null);
  const unionWrapRef = useRef<HTMLDivElement>(null);
  const unionBackdropRef = useRef<HTMLDivElement>(null);
  const surfaceCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskSvgRef = useRef<SVGSVGElement>(null);
  const maskElRef = useRef<SVGMaskElement>(null);
  const maskPathRef = useRef<SVGPathElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);

  const webglRef = useRef<UnionWebGLRenderer | null>(null);
  const webglInitTriedRef = useRef(false);

  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const settleTimerRef = useRef<number | null>(null);
  const filterNodeRef = useRef<{
    filter: SVGFilterElement;
    feBar: SVGFEImageElement;
    feOrb: SVGFEImageElement;
    feDisp: SVGFEDisplacementMapElement;
  } | null>(null);
  const motionDispCacheRef = useRef<MotionDispCache | null>(null);

  // Tracks the EXACT last rendered snapshot (never overwritten when skipped -> zero spring-tail drift!)
  const lastRenderedRef = useRef<{
    w: number;
    h: number;
    dpr: number;
    k: number;
    a: UnionCapsule;
    b: UnionCapsule;
    pathD: string;
  } | null>(null);
  const dispModeRef = useRef<"none" | "motion" | "settled">("none");
  const lastToneKeyRef = useRef("");

  const safeMergeRadius = Math.max(0, mergeRadius);
  const useHic = Boolean(stage.hicBridge);
  const frostOnly = stage.tier === "frost" || stage.config.engine === "frost";
  const enableCssUnion = !useHic && !frostOnly && safeMergeRadius > 0;

  const morphGroup = useMemo(
    () => (safeMergeRadius > 0 ? registerMorphGroup(resolvedId) : 0),
    [safeMergeRadius, registerMorphGroup, resolvedId],
  );

  const unionFilterId = `lgw-union-disp-${safeId}`;
  const unionMaskId = `lgw-union-mask-${safeId}`;

  // Latest values live in a ref so the 120Hz paint loop never rebinds callbacks
  const stageLiveRef = useRef({
    config: stage.config,
    effectiveFg: stage.effectiveFg,
    legibility: stage.legibility,
    reducedMotion: stage.reducedMotion,
    moreContrast: stage.capabilities.moreContrast,
  });
  useLayoutEffect(() => {
    stageLiveRef.current = {
      config: stage.config,
      effectiveFg: stage.effectiveFg,
      legibility: stage.legibility,
      reducedMotion: stage.reducedMotion,
      moreContrast: stage.capabilities.moreContrast,
    };
  });

  const applyBackdropCss = useCallback(
    (withDispFilter: boolean) => {
      const backdropEl = unionBackdropRef.current;
      if (!backdropEl) return;
      const c = stageLiveRef.current.config;
      const parts = [
        c.blur > 0.05 ? `blur(${c.blur.toFixed(2)}px)` : "",
        withDispFilter ? `url(#${unionFilterId})` : "",
        Math.abs(c.saturate - 1) > 0.005 ? `saturate(${c.saturate.toFixed(2)})` : "",
        Math.abs(c.brightness - 1) > 0.005 ? `brightness(${c.brightness.toFixed(2)})` : "",
        Math.abs(c.contrast - 1) > 0.005 ? `contrast(${c.contrast.toFixed(2)})` : "",
      ].filter(Boolean);
      const val = parts.join(" ") || "blur(2px) saturate(1.25)";
      backdropEl.style.setProperty("--lgw-union-backdrop", val);
    },
    [unionFilterId],
  );

  const buildOpticsSpec = useCallback((a: UnionCapsule, b: UnionCapsule): {
    optics: GlassOptics;
    lighting: DualLightingSpec;
    activeStrength: number;
    edgeAlpha: number;
    borderWidth: number;
  } => {
    const { config: c, reducedMotion, moreContrast } = stageLiveRef.current;
    const outerRadius = Math.min(a.r, a.hw, a.hh, b.r, b.hw, b.hh);
    const activeStrength = moreContrast
      ? 0
      : reducedMotion
        ? c.strength * REDUCED_MOTION_STRENGTH
        : c.strength;
    const activeDispersion = moreContrast ? 0 : c.dispersion;
    const blueFactor = activeDispersion > 0.01 ? maxSpectralFactor(activeDispersion) : 1;
    const worstMultiplier =
      Math.max(1, activeStrength) *
      (c.pressCompression && !reducedMotion ? GLASS_PHYSICS.pressOpticalGain : 1) *
      blueFactor;

    const optics: GlassOptics = {
      bezel: Math.min(c.bezel, outerRadius),
      thickness: c.thickness,
      ior: c.ior,
      profile: c.profile,
      minJacobian: c.minJacobian,
      maxMultiplier: worstMultiplier,
    };

    const lighting: DualLightingSpec = {
      angleDeg: c.lightAngleDeg,
      lift: c.lightLift,
      exponent: c.lightExponent,
      backBounce: c.backBounce,
      highlight: c.highlightColor,
      shade: c.shadeColor,
    };

    const edgeAlpha = c.edgeRingAlpha;
    const borderWidth = edgeAlpha > 0.005 ? 1 : 0;
    return { optics, lighting, activeStrength, edgeAlpha, borderWidth };
  }, []);

  const ensureFilterNode = useCallback(() => {
    const host = stage.hasStageSvg ? stage.svgHostRef.current : localSvgRef.current;
    if (!host) return null;

    if (!filterNodeRef.current) {
      const filter = document.createElementNS(SVG_NS, "filter");
      filter.setAttribute("id", unionFilterId);
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("primitiveUnits", "userSpaceOnUse");
      filter.setAttribute("color-interpolation-filters", "sRGB");

      const feFlood = document.createElementNS(SVG_NS, "feFlood");
      feFlood.setAttribute("flood-color", "rgb(128,128,128)");
      feFlood.setAttribute("flood-opacity", "1");
      feFlood.setAttribute("result", "neutral");

      const feBar = document.createElementNS(SVG_NS, "feImage");
      feBar.setAttribute("preserveAspectRatio", "none");
      feBar.setAttribute("result", "bar");

      const feOrb = document.createElementNS(SVG_NS, "feImage");
      feOrb.setAttribute("preserveAspectRatio", "none");
      feOrb.setAttribute("result", "orb");

      const feMerge = document.createElementNS(SVG_NS, "feMerge");
      feMerge.setAttribute("result", "map");
      for (const src of ["neutral", "bar", "orb"]) {
        const node = document.createElementNS(SVG_NS, "feMergeNode");
        node.setAttribute("in", src);
        feMerge.append(node);
      }

      const feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
      feDisp.setAttribute("in", "SourceGraphic");
      feDisp.setAttribute("in2", "map");
      feDisp.setAttribute("xChannelSelector", "R");
      feDisp.setAttribute("yChannelSelector", "G");

      filter.append(feFlood, feBar, feOrb, feMerge, feDisp);
      host.append(filter);
      filterNodeRef.current = { filter, feBar, feOrb, feDisp };
    } else if (filterNodeRef.current.filter.parentNode !== host) {
      host.append(filterNodeRef.current.filter);
    }

    return filterNodeRef.current;
  }, [stage.hasStageSvg, stage.svgHostRef, unionFilterId]);

  /**
   * Renders unified pure-SDF outer shadow + Beer–Lambert tint + scrim + exact 3D Schlick
   * Fresnel + 1px optical edge at FULL Retina DPR on EVERY frame via WebGL2 (~0.15ms/frame),
   * falling back seamlessly to the identical pure-math CPU renderer if WebGL2 is unavailable.
   */
  const paintUnionSurface = useCallback(
    (w: number, h: number, a: UnionCapsule, b: UnionCapsule) => {
      const canvas = surfaceCanvasRef.current;
      if (!canvas) return;
      const { config: c, effectiveFg, legibility } = stageLiveRef.current;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const scale = sheetScale(dpr);

      const { optics, lighting, edgeAlpha, borderWidth } = buildOpticsSpec(a, b);
      const isLightFg = effectiveFg === "light";
      const bodyRgb = c.adaptiveContrast
        ? isLightFg
          ? { r: 12, g: 16, b: 26 }
          : { r: 250, g: 251, b: 254 }
        : c.tintColor;
      const scrimRgb =
        c.adaptiveContrast && legibility
          ? { r: legibility.scrimRgb[0], g: legibility.scrimRgb[1], b: legibility.scrimRgb[2] }
          : { r: 0, g: 0, b: 0 };
      const scrimAlpha =
        c.adaptiveContrast && legibility && legibility.scrimAlpha > 0.005
          ? legibility.scrimAlpha
          : 0;
      const edgeRgb = c.edgeRingLight ? { r: 255, g: 255, b: 255 } : { r: 15, g: 18, b: 26 };

      const params: PolySminOpticsParams = {
        optics,
        lighting,
        bodyRgb,
        bodyAlpha: c.tintAlpha,
        rimAlphaMin: c.rimAlphaMin,
        scrimRgb,
        scrimAlpha,
        edgeRgb,
        edgeAlpha,
        borderWidth,
        shadowAlpha: c.shadowAlpha,
        padCss: SHADOW_PAD,
        scale,
      };

      if (!webglInitTriedRef.current) {
        webglInitTriedRef.current = true;
        webglRef.current = createUnionWebGLRenderer(canvas);
      }

      if (webglRef.current && webglRef.current.render(w, h, a, b, safeMergeRadius, params)) {
        return;
      }

      // Identical pure-math CPU fallback (still full DPR and zero destination-out fringe)
      const tile = bakePolySminOptics(w, h, a, b, safeMergeRadius, params);
      if (canvas.width !== tile.width || canvas.height !== tile.height) {
        canvas.width = tile.width;
        canvas.height = tile.height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(tile.data), tile.width, tile.height),
        0,
        0,
      );
    },
    [buildOpticsSpec, safeMergeRadius],
  );

  /**
   * Keeps Tier 1 Snell refraction LIVE on every single 120Hz motion frame by translating
   * a pre-baked static orb tile over a pre-baked static bar tile (0 PNG encodes per frame!).
   */
  const updateMotionDisplacement = useCallback(
    (w: number, h: number, a: UnionCapsule, b: UnionCapsule) => {
      if (!detectChromiumSvgBackdrop()) {
        applyBackdropCss(false);
        dispModeRef.current = "none";
        return;
      }

      const { optics, activeStrength } = buildOpticsSpec(a, b);
      if (activeStrength <= 0.01) {
        applyBackdropCss(false);
        dispModeRef.current = "none";
        return;
      }

      const node = ensureFilterNode();
      if (!node) return;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const left = a.cx <= b.cx ? a : b;
      const right = a.cx <= b.cx ? b : a;
      const barW = left.hw * 2;
      const barH = left.hh * 2;
      const orbW = right.hw * 2;
      const orbH = right.hh * 2;

      const cacheKey = [
        barW.toFixed(1),
        barH.toFixed(1),
        orbW.toFixed(1),
        orbH.toFixed(1),
        optics.profile,
        optics.bezel.toFixed(2),
        optics.thickness.toFixed(2),
        optics.ior.toFixed(4),
        optics.minJacobian.toFixed(3),
        (optics.maxMultiplier ?? 1).toFixed(3),
        tileScale(dpr).toFixed(2),
      ].join("|");

      let cache = motionDispCacheRef.current;
      if (!cache || cache.key !== cacheKey) {
        const s = tileScale(dpr);
        const barRes = buildCapsuleDisplacementMap(barW, barH, left.r, optics, s);
        const orbRes = buildCapsuleDisplacementMap(orbW, orbH, right.r, optics, s);
        const barUrl = encodeUnionTile(barRes.tile.width, barRes.tile.height, barRes.tile.data);
        const orbUrl = encodeUnionTile(orbRes.tile.width, orbRes.tile.height, orbRes.tile.data);
        if (!barUrl || !orbUrl) return;
        cache = { key: cacheKey, barUrl, orbUrl, dMax: Math.max(barRes.dMax, orbRes.dMax) };
        motionDispCacheRef.current = cache;
      }

      const { filter, feBar, feOrb, feDisp } = node;
      const wStr = w.toFixed(2);
      const hStr = h.toFixed(2);
      filter.setAttribute("x", "0");
      filter.setAttribute("y", "0");
      filter.setAttribute("width", wStr);
      filter.setAttribute("height", hStr);

      if (dispModeRef.current !== "motion" || feBar.getAttribute("href") !== cache.barUrl) {
        feBar.setAttribute("href", cache.barUrl);
        feOrb.setAttribute("href", cache.orbUrl);
      }

      feBar.setAttribute("x", (left.cx - left.hw).toFixed(2));
      feBar.setAttribute("y", (left.cy - left.hh).toFixed(2));
      feBar.setAttribute("width", barW.toFixed(2));
      feBar.setAttribute("height", barH.toFixed(2));

      feOrb.setAttribute("x", (right.cx - right.hw).toFixed(2));
      feOrb.setAttribute("y", (right.cy - right.hh).toFixed(2));
      feOrb.setAttribute("width", orbW.toFixed(2));
      feOrb.setAttribute("height", orbH.toFixed(2));

      const dispScale = 2 * cache.dMax * Math.max(0, activeStrength);
      feDisp.setAttribute("scale", String(Math.round(dispScale * 1000) / 1000));
      applyBackdropCss(dispScale > 0.05);
      dispModeRef.current = "motion";
    },
    [applyBackdropCss, buildOpticsSpec, ensureFilterNode],
  );

  /** Upgrades Tier 1 displacement map to the unified 2x polySmin saddle field once settled. */
  const bakeSettledDisplacement = useCallback(() => {
    const snap = lastRenderedRef.current;
    if (!enableCssUnion || !snap) return;

    // Ensure full-DPR surface reflects latest optics/config
    paintUnionSurface(snap.w, snap.h, snap.a, snap.b);

    if (!detectChromiumSvgBackdrop()) {
      applyBackdropCss(false);
      dispModeRef.current = "none";
      return;
    }

    const { optics, activeStrength } = buildOpticsSpec(snap.a, snap.b);
    if (activeStrength <= 0.01) {
      applyBackdropCss(false);
      dispModeRef.current = "none";
      return;
    }

    const node = ensureFilterNode();
    if (!node) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const { tile, dMax } = buildPolySminDisplacementMap(
      snap.w,
      snap.h,
      snap.a,
      snap.b,
      safeMergeRadius,
      optics,
      tileScale(dpr),
    );
    const dataUrl = encodeUnionTile(tile.width, tile.height, tile.data);
    if (!dataUrl) return;

    const { filter, feBar, feOrb, feDisp } = node;
    const wStr = snap.w.toFixed(2);
    const hStr = snap.h.toFixed(2);
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", wStr);
    filter.setAttribute("height", hStr);

    feBar.setAttribute("x", "0");
    feBar.setAttribute("y", "0");
    feBar.setAttribute("width", wStr);
    feBar.setAttribute("height", hStr);
    feBar.setAttribute("href", dataUrl);

    // Collapse secondary orb layer while unified polySmin saddle tile is active
    feOrb.setAttribute("x", "0");
    feOrb.setAttribute("y", "0");
    feOrb.setAttribute("width", "0");
    feOrb.setAttribute("height", "0");

    const dispScale = 2 * dMax * Math.max(0, activeStrength);
    feDisp.setAttribute("scale", String(Math.round(dispScale * 1000) / 1000));
    applyBackdropCss(dispScale > 0.05);
    dispModeRef.current = "settled";
  }, [
    applyBackdropCss,
    buildOpticsSpec,
    enableCssUnion,
    ensureFilterNode,
    paintUnionSurface,
    safeMergeRadius,
  ]);

  const syncUnion = useCallback(() => {
    const containerEl = containerRef.current;
    const unionWrap = unionWrapRef.current;
    if (!containerEl || !unionWrap) return;

    const clearUnion = () => {
      containerEl.removeAttribute("data-lgw-union");
      containerEl.removeAttribute("data-lgw-union-orb-cx");
      unionWrap.style.display = "none";
      lastRenderedRef.current = null;
      dispModeRef.current = "none";
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };

    if (!enableCssUnion || elementsRef.current.size < 2) {
      clearUnion();
      return;
    }

    const cr = containerEl.getBoundingClientRect();
    if (cr.width <= 4 || cr.height <= 4) {
      clearUnion();
      return;
    }

    const caps: UnionCapsule[] = [];
    for (const el of elementsRef.current.values()) {
      const r = el.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4) continue;
      const hw = r.width / 2;
      const hh = r.height / 2;
      const rawRad = getComputedStyle(el).borderTopLeftRadius.trim().split(/\s+/)[0] ?? "";
      const parsedRad = Number.parseFloat(rawRad);
      const cssRad = Number.isFinite(parsedRad)
        ? rawRad.endsWith("%")
          ? (parsedRad / 100) * r.width
          : parsedRad
        : Math.min(hw, hh);
      caps.push({
        cx: r.left - cr.left + hw,
        cy: r.top - cr.top + hh,
        hw,
        hh,
        r: Math.max(2, Math.min(cssRad, hw, hh)),
      });
    }

    if (caps.length < 2) {
      clearUnion();
      return;
    }

    // Select the closest horizontal pair inside the container
    let capA = caps[0];
    let capB = caps[1];
    if (caps.length > 2) {
      let bestGap = Infinity;
      for (let i = 0; i < caps.length; i++) {
        for (let j = i + 1; j < caps.length; j++) {
          const left = caps[i].cx <= caps[j].cx ? caps[i] : caps[j];
          const right = caps[i].cx <= caps[j].cx ? caps[j] : caps[i];
          const g = right.cx - right.hw - (left.cx + left.hw);
          if (g < bestGap) {
            bestGap = g;
            capA = left;
            capB = right;
          }
        }
      }
    }

    const contour = buildPolySminPath(capA, capB, safeMergeRadius);
    if (!contour) {
      clearUnion();
      return;
    }

    containerEl.setAttribute("data-lgw-union", "true");
    unionWrap.style.display = "block";

    // Exact fractional CSS dimensions (eliminates Math.ceil sub-pixel rim stretch)
    const w = cr.width;
    const h = cr.height;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    // Compare against the LAST ACTUALLY RENDERED pose (tight 0.02px threshold -> zero spring-tail drift!)
    const prev = lastRenderedRef.current;
    const changed =
      !prev ||
      Math.abs(dpr - prev.dpr) > 0.01 ||
      Math.abs(prev.k - safeMergeRadius) > 0.05 ||
      Math.abs(prev.w - w) > 0.05 ||
      Math.abs(prev.h - h) > 0.05 ||
      Math.abs(prev.a.cx - capA.cx) > 0.02 ||
      Math.abs(prev.a.cy - capA.cy) > 0.02 ||
      Math.abs(prev.b.cx - capB.cx) > 0.02 ||
      Math.abs(prev.b.cy - capB.cy) > 0.02 ||
      Math.abs(prev.a.hw - capA.hw) > 0.05 ||
      Math.abs(prev.b.hw - capB.hw) > 0.05 ||
      Math.abs(prev.a.r - capA.r) > 0.1 ||
      Math.abs(prev.b.r - capB.r) > 0.1;

    if (!changed) return;

    const pathD = contour.path;
    lastRenderedRef.current = { w, h, dpr, k: safeMergeRadius, a: capA, b: capB, pathD };
    const rightCap = capA.cx <= capB.cx ? capB : capA;
    containerEl.setAttribute("data-lgw-union-orb-cx", rightCap.cx.toFixed(2));

    // 1. Synchronous inline DOM SVG <mask> (ZERO async data-URI decode lag!)
    const wStr = w.toFixed(2);
    const hStr = h.toFixed(2);
    maskSvgRef.current?.setAttribute("viewBox", `0 0 ${wStr} ${hStr}`);
    if (maskElRef.current) {
      maskElRef.current.setAttribute("width", wStr);
      maskElRef.current.setAttribute("height", hStr);
    }
    maskPathRef.current?.setAttribute("d", pathD);

    const backdropEl = unionBackdropRef.current;
    if (backdropEl) {
      const maskRef = `url(#${unionMaskId})`;
      if (backdropEl.style.maskImage !== maskRef) {
        backdropEl.style.setProperty("-webkit-mask-image", maskRef);
        backdropEl.style.maskImage = maskRef;
      }
    }

    // 2. Full-DPR WebGL2 pure-SDF outer shadow + Beer–Lambert + exact 3D Schlick Fresnel (~0.15ms!)
    paintUnionSurface(w, h, capA, capB);

    // 3. Live zero-bake Tier 1 Snell refraction during motion (never snaps flat!)
    updateMotionDisplacement(w, h, capA, capB);

    // 4. Upgrade displacement map to unified 2x polySmin saddle once motion truly settles
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      bakeSettledDisplacement();
    }, 65);
  }, [
    bakeSettledDisplacement,
    enableCssUnion,
    paintUnionSurface,
    safeMergeRadius,
    unionMaskId,
    updateMotionDisplacement,
  ]);

  const registerUnionElement = useCallback(
    (key: string, el: HTMLElement | null) => {
      if (el) elementsRef.current.set(key, el);
      else elementsRef.current.delete(key);
      syncUnion();
    },
    [syncUnion],
  );

  const notifyUnionMove = useCallback(() => {
    syncUnion();
  }, [syncUnion]);

  useEffect(() => {
    if (!enableCssUnion) {
      containerRef.current?.removeAttribute("data-lgw-union");
      containerRef.current?.removeAttribute("data-lgw-union-orb-cx");
      if (unionWrapRef.current) unionWrapRef.current.style.display = "none";
      lastRenderedRef.current = null;
      dispModeRef.current = "none";
      return;
    }
    syncUnion();
    const raf = requestAnimationFrame(syncUnion);
    const el = containerRef.current;
    const ro = el ? new ResizeObserver(() => syncUnion()) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", syncUnion);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", syncUnion);
    };
  }, [enableCssUnion, syncUnion, stage.layoutVersion]);

  // Rebake when the material config changes
  useEffect(() => {
    if (!enableCssUnion || !lastRenderedRef.current) return;
    motionDispCacheRef.current = null;
    bakeSettledDisplacement();
  }, [
    enableCssUnion,
    stage.config,
    stage.reducedMotion,
    stage.capabilities.moreContrast,
    bakeSettledDisplacement,
  ]);

  // Repaint only the WebGL2 surface when text polarity or scrim values change (keeps Snell filter intact)
  const scrimKey = stage.legibility
    ? `${stage.legibility.scrimRgb.join(",")}:${stage.legibility.scrimAlpha.toFixed(3)}`
    : "none";
  const toneKey = `${stage.effectiveFg}|${scrimKey}`;

  useEffect(() => {
    const snap = lastRenderedRef.current;
    if (!enableCssUnion || !snap) {
      lastToneKeyRef.current = toneKey;
      return;
    }
    if (lastToneKeyRef.current === toneKey) return;
    lastToneKeyRef.current = toneKey;
    paintUnionSurface(snap.w, snap.h, snap.a, snap.b);
  }, [enableCssUnion, toneKey, paintUnionSurface]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      filterNodeRef.current?.filter.remove();
      filterNodeRef.current = null;
      webglRef.current?.destroy();
      webglRef.current = null;
      webglInitTriedRef.current = false;
    };
  }, []);

  const ctx = useMemo(
    () => ({
      id: resolvedId,
      morphGroup,
      mergeRadius: safeMergeRadius,
      registerUnionElement,
      notifyUnionMove,
    }),
    [resolvedId, morphGroup, safeMergeRadius, registerUnionElement, notifyUnionMove],
  );

  return (
    <GlassContainerContext.Provider value={ctx}>
      <div
        ref={containerRef}
        className={className ? `lgw-container ${className}` : "lgw-container"}
        data-lgw-container={resolvedId}
        style={style}
      >
        {enableCssUnion && (
          <>
            {!stage.hasStageSvg && (
              <svg ref={localSvgRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />
            )}
            <svg
              ref={maskSvgRef}
              className="lgw-svg-host"
              aria-hidden="true"
              focusable="false"
            >
              <mask
                ref={maskElRef}
                id={unionMaskId}
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="0"
                height="0"
              >
                <path ref={maskPathRef} fill="#fff" />
              </mask>
            </svg>
            <div
              ref={unionWrapRef}
              className="lgw-container__union"
              style={{ display: "none" }}
              aria-hidden="true"
            >
              {/* Live backdrop-filter masked synchronously via inline DOM <mask> */}
              <div ref={unionBackdropRef} className="lgw-container__union-backdrop" />

              {/* Full-DPR WebGL2 pure-SDF outer shadow + Beer–Lambert + 3D Schlick Fresnel */}
              <canvas
                ref={surfaceCanvasRef}
                className="lgw-container__union-surface lgw-container__union-optics"
              />
            </div>
          </>
        )}
        {children}
      </div>
    </GlassContainerContext.Provider>
  );
}
