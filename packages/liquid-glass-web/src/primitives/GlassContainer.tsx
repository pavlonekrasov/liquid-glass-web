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
  buildPolySminDisplacementMap,
  buildPolySminPath,
  type UnionCapsule,
} from "../core/union.ts";
import { detectChromiumSvgBackdrop } from "../engines/capabilities.ts";
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
  const shadowCanvasRef = useRef<HTMLCanvasElement>(null);
  const opticsCanvasRef = useRef<HTMLCanvasElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);

  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const settleTimerRef = useRef<number | null>(null);
  const filterNodeRef = useRef<{
    filter: SVGFilterElement;
    feImage: SVGFEImageElement;
    feDisp: SVGFEDisplacementMapElement;
  } | null>(null);
  const lastSnapRef = useRef<{
    w: number;
    h: number;
    a: UnionCapsule;
    b: UnionCapsule;
    pathD: string;
  } | null>(null);
  const dispActiveRef = useRef(false);
  const lastToneKeyRef = useRef("");
  const lastDprRef = useRef(1);

  const safeMergeRadius = Math.max(0, mergeRadius);
  const useHic = Boolean(stage.hicBridge);
  const frostOnly = stage.tier === "frost" || stage.config.engine === "frost";
  const enableCssUnion = !useHic && !frostOnly && safeMergeRadius > 0;

  const morphGroup = useMemo(
    () => (safeMergeRadius > 0 ? registerMorphGroup(resolvedId) : 0),
    [safeMergeRadius, registerMorphGroup, resolvedId],
  );

  const unionFilterId = `lgw-union-disp-${safeId}`;

  // Latest values live in a ref so the paint loop never rebinds callbacks
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
      dispActiveRef.current = withDispFilter;
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

  /** Paints the outer shadow on a canvas without darkening the interior. */
  const paintUnionShadow = useCallback((w: number, h: number, pathD: string, scale: number) => {
    const canvas = shadowCanvasRef.current;
    if (!canvas || typeof Path2D === "undefined") return;
    const { config: c } = stageLiveRef.current;
    const cw = w + SHADOW_PAD * 2;
    const ch = h + SHADOW_PAD * 2;
    const pw = Math.max(2, Math.round(cw * scale));
    const ph = Math.max(2, Math.round(ch * scale));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(SHADOW_PAD, SHADOW_PAD);

    const shape = new Path2D(pathD);
    ctx.fillStyle = "rgb(15, 20, 32)";

    // Far shadow (matches the .lgw-glass-surface box-shadow)
    ctx.shadowColor = `rgba(15, 20, 32, ${(c.shadowAlpha * 0.92).toFixed(3)})`;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 7;
    ctx.fill(shape);

    // Near contact shadow
    ctx.shadowColor = `rgba(15, 20, 32, ${(c.shadowAlpha * 0.55).toFixed(3)})`;
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.fill(shape);

    // Cut out the interior so the shadow never tints the glass
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill(shape);
    ctx.restore();
  }, []);

  /** Paints tint, scrim and Fresnel rim on a canvas. */
  const paintUnionOptics = useCallback(
    (w: number, h: number, a: UnionCapsule, b: UnionCapsule, highRes: boolean) => {
      const canvas = opticsCanvasRef.current;
      if (!canvas) return;
      const { config: c, effectiveFg, legibility } = stageLiveRef.current;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const scale = highRes ? sheetScale(dpr) : 1;

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

      const tile = bakePolySminOptics(w, h, a, b, safeMergeRadius, {
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
        scale,
      });

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

  /** Bakes the fused displacement map for Tier 1 once settled. */
  const bakeSettledDisplacement = useCallback(() => {
    const snap = lastSnapRef.current;
    if (!enableCssUnion || !snap) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // Full-resolution canvases once settled
    paintUnionShadow(snap.w, snap.h, snap.pathD, sheetScale(dpr));
    paintUnionOptics(snap.w, snap.h, snap.a, snap.b, true);

    if (!detectChromiumSvgBackdrop()) {
      applyBackdropCss(false);
      return;
    }

    const { optics, activeStrength } = buildOpticsSpec(snap.a, snap.b);
    if (activeStrength <= 0.01) {
      applyBackdropCss(false);
      return;
    }

    const host = stage.hasStageSvg ? stage.svgHostRef.current : localSvgRef.current;
    if (!host) return;

    if (!filterNodeRef.current) {
      const filter = document.createElementNS(SVG_NS, "filter");
      filter.setAttribute("id", unionFilterId);
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("primitiveUnits", "userSpaceOnUse");
      filter.setAttribute("color-interpolation-filters", "sRGB");
      const feImage = document.createElementNS(SVG_NS, "feImage");
      feImage.setAttribute("preserveAspectRatio", "none");
      feImage.setAttribute("result", "map");
      const feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
      feDisp.setAttribute("in", "SourceGraphic");
      feDisp.setAttribute("in2", "map");
      feDisp.setAttribute("xChannelSelector", "R");
      feDisp.setAttribute("yChannelSelector", "G");
      filter.append(feImage, feDisp);
      host.append(filter);
      filterNodeRef.current = { filter, feImage, feDisp };
    } else if (filterNodeRef.current.filter.parentNode !== host) {
      host.append(filterNodeRef.current.filter);
    }

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

    const { filter, feImage, feDisp } = filterNodeRef.current;
    const wStr = String(snap.w);
    const hStr = String(snap.h);
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", wStr);
    filter.setAttribute("height", hStr);
    feImage.setAttribute("x", "0");
    feImage.setAttribute("y", "0");
    feImage.setAttribute("width", wStr);
    feImage.setAttribute("height", hStr);
    feImage.setAttribute("href", dataUrl);
    const dispScale = 2 * dMax * Math.max(0, activeStrength);
    feDisp.setAttribute("scale", String(Math.round(dispScale * 1000) / 1000));
    applyBackdropCss(dispScale > 0.05);
  }, [
    applyBackdropCss,
    buildOpticsSpec,
    enableCssUnion,
    paintUnionOptics,
    paintUnionShadow,
    safeMergeRadius,
    stage.hasStageSvg,
    stage.svgHostRef,
    unionFilterId,
  ]);

  const syncUnion = useCallback(() => {
    const containerEl = containerRef.current;
    const unionWrap = unionWrapRef.current;
    if (!containerEl || !unionWrap) return;

    if (!enableCssUnion || elementsRef.current.size < 2) {
      containerEl.removeAttribute("data-lgw-union");
      unionWrap.style.display = "none";
      lastSnapRef.current = null;
      dispActiveRef.current = false;
      return;
    }

    const cr = containerEl.getBoundingClientRect();
    if (cr.width <= 4 || cr.height <= 4) {
      containerEl.removeAttribute("data-lgw-union");
      unionWrap.style.display = "none";
      lastSnapRef.current = null;
      dispActiveRef.current = false;
      return;
    }

    const caps: UnionCapsule[] = [];
    for (const el of elementsRef.current.values()) {
      const r = el.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4) continue;
      const hw = r.width / 2;
      const hh = r.height / 2;
      caps.push({
        cx: r.left - cr.left + hw,
        cy: r.top - cr.top + hh,
        hw,
        hh,
        r: Math.min(hw, hh),
      });
    }

    if (caps.length < 2) {
      containerEl.removeAttribute("data-lgw-union");
      unionWrap.style.display = "none";
      lastSnapRef.current = null;
      dispActiveRef.current = false;
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
      containerEl.removeAttribute("data-lgw-union");
      unionWrap.style.display = "none";
      lastSnapRef.current = null;
      dispActiveRef.current = false;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }

    containerEl.setAttribute("data-lgw-union", "true");
    unionWrap.style.display = "block";

    const w = Math.ceil(cr.width);
    const h = Math.ceil(cr.height);
    const pathD = contour.path;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    const prev = lastSnapRef.current;
    const moved =
      !prev ||
      Math.abs(dpr - lastDprRef.current) > 0.01 ||
      Math.abs(prev.w - w) > 0.5 ||
      Math.abs(prev.h - h) > 0.5 ||
      Math.abs(prev.a.cx - capA.cx) > 0.2 ||
      Math.abs(prev.b.cx - capB.cx) > 0.2 ||
      Math.abs(prev.a.hw - capA.hw) > 0.2 ||
      Math.abs(prev.b.hw - capB.hw) > 0.2;

    lastDprRef.current = dpr;
    lastSnapRef.current = { w, h, a: capA, b: capB, pathD };

    if (moved) {
      const backdropEl = unionBackdropRef.current;
      if (backdropEl) {
        // Alpha mask clips the backdrop-filter to the fused shape
        const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${pathD}" fill="#fff"/></svg>`;
        const maskVal = `url("data:image/svg+xml,${encodeURIComponent(maskSvg)}")`;
        backdropEl.style.setProperty("-webkit-mask-image", maskVal);
        backdropEl.style.maskImage = maskVal;
      }

      // 1x canvases while animating
      paintUnionShadow(w, h, pathD, 1);
      paintUnionOptics(w, h, capA, capB, false);
      applyBackdropCss(false);

      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        bakeSettledDisplacement();
      }, 65);
    }
  }, [
    applyBackdropCss,
    bakeSettledDisplacement,
    enableCssUnion,
    paintUnionOptics,
    paintUnionShadow,
    safeMergeRadius,
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
      if (unionWrapRef.current) unionWrapRef.current.style.display = "none";
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
    if (!enableCssUnion || !lastSnapRef.current) return;
    bakeSettledDisplacement();
  }, [
    enableCssUnion,
    stage.config,
    stage.reducedMotion,
    stage.capabilities.moreContrast,
    bakeSettledDisplacement,
  ]);

  // Repaint only when text polarity or scrim values change
  const scrimKey = stage.legibility
    ? `${stage.legibility.scrimRgb.join(",")}:${stage.legibility.scrimAlpha.toFixed(3)}`
    : "none";
  const toneKey = `${stage.effectiveFg}|${scrimKey}`;

  useEffect(() => {
    const snap = lastSnapRef.current;
    if (!enableCssUnion || !snap) {
      lastToneKeyRef.current = toneKey;
      return;
    }
    if (lastToneKeyRef.current === toneKey) return;
    lastToneKeyRef.current = toneKey;
    paintUnionOptics(snap.w, snap.h, snap.a, snap.b, true);
  }, [enableCssUnion, toneKey, paintUnionOptics]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      filterNodeRef.current?.filter.remove();
      filterNodeRef.current = null;
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
            <div
              ref={unionWrapRef}
              className="lgw-container__union"
              style={{ display: "none" }}
              aria-hidden="true"
            >
              <canvas ref={shadowCanvasRef} className="lgw-container__union-shadow" />

              {/* backdrop-filter is set through a CSS variable so re-renders don't drop url(#disp) */}
              <div ref={unionBackdropRef} className="lgw-container__union-backdrop" />

              <canvas ref={opticsCanvasRef} className="lgw-container__union-optics" />
            </div>
          </>
        )}
        {children}
      </div>
    </GlassContainerContext.Provider>
  );
}
