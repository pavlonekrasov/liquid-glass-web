"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { animate, type AnimationPlaybackControls } from "motion/react";
import type { SRGB } from "../core/color.ts";
import {
  DEFAULT_POLARITY_DWELL_MS,
  solveAdaptiveLegibility,
  stabilizePolarity,
  type AdaptiveLegibilityResult,
  type PolarityStabilityState,
} from "../core/legibility.ts";
import {
  clamp01,
  GLASS_PHYSICS,
  GLASS_SPRINGS,
  glassDeformationForSize,
  projectMomentum,
  resolveGlassTransitionMode,
  rubberband,
  smoothstep,
  tapFlightBell,
  velocityStretch,
  type InteractionSource,
} from "../core/motion.ts";
import {
  buildClampTable,
  maxSpectralFactor,
  SPECTRAL_BANDS,
  spectralDelta,
} from "../core/optics.ts";
import {
  resolveGlassConfig,
  type GlassActivePillStyle,
  type GlassMaterialProps,
} from "../core/presets.ts";
import { sampleBackdropBehind } from "../engines/backdropSampler.ts";
import { useLiquidGlass, type LiquidGlassDiagnostics } from "../engines/useLiquidGlass.ts";
import { useGlassContainer, useGlassStage } from "../primitives/context.tsx";

export interface GlassTabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode | ((active: boolean) => ReactNode);
  readonly ariaLabel?: string;
}

export type GlassTabBarSize = "compact" | "icons" | "text";

export interface GlassTabBarDiagnostics {
  readonly bar: LiquidGlassDiagnostics | null;
  readonly loupe: LiquidGlassDiagnostics | null;
  readonly legibility: AdaptiveLegibilityResult | null;
}

export interface GlassTabBarProps extends GlassMaterialProps {
  readonly items: readonly GlassTabItem[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly size?: GlassTabBarSize;
  readonly activePill?: GlassActivePillStyle;
  /** Parks the lifted refracting loupe between tab 0 and tab 1 for optical inspection. */
  readonly parkedLoupe?: boolean;
  readonly "aria-label"?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onDiagnostics?: (diag: GlassTabBarDiagnostics) => void;
}

const TAP_LOUPE_PEAK_NEAR = 0.62;
const TAP_LOUPE_PEAK_FAR = 0.78;
const HANDOFF_HI = 0.34;
const HANDOFF_LO = 0.02;
const CUTOUT_W = 960;
const CUTOUT_H = 200;

function buildLoupeCutoutMask(loupeW: number, loupeH: number): string {
  const x = (CUTOUT_W - loupeW) / 2;
  const y = (CUTOUT_H - loupeH) / 2;
  const rx = loupeH / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CUTOUT_W}" height="${CUTOUT_H}"><rect width="100%" height="100%" fill="#fff"/><rect x="${x}" y="${y}" width="${loupeW}" height="${loupeH}" rx="${rx}" fill="#000"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function renderTabIcon(icon: GlassTabItem["icon"], active: boolean): ReactNode {
  if (!icon) return null;
  return typeof icon === "function" ? icon(active) : icon;
}

export function GlassTabBar({
  items,
  value,
  onChange,
  size = "compact",
  variant,
  shapeProfile,
  refraction,
  dispersion,
  frost,
  interactive,
  adaptiveContrast,
  engine,
  optics,
  activePill,
  parkedLoupe = false,
  "aria-label": ariaLabel = "Navigation tabs",
  className,
  style,
  onDiagnostics,
}: GlassTabBarProps) {
  const stage = useGlassStage();
  const container = useGlassContainer();
  const instanceId = useId();

  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const ghostBarRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const restThumbRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const localSvgRef = useRef<SVGSVGElement>(null);

  const hasStageSvg = stage.svgHostRef.current !== null;
  const svgRef = hasStageSvg ? stage.svgHostRef : localSvgRef;

  const activeIdx = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );

  const config = useMemo(() => {
    const mergedOptics = activePill ? { ...optics, activePill } : optics;
    return resolveGlassConfig(
      {
        variant,
        shapeProfile,
        refraction,
        dispersion,
        frost,
        interactive,
        adaptiveContrast,
        engine,
        optics: mergedOptics,
      },
      stage.config,
    );
  }, [
    variant,
    shapeProfile,
    refraction,
    dispersion,
    frost,
    interactive,
    adaptiveContrast,
    engine,
    optics,
    activePill,
    stage.config,
  ]);

  const { syncStageConfig } = stage;
  useEffect(() => {
    syncStageConfig(config);
  }, [config, syncStageConfig]);

  const [barPressed, setBarPressed] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [previewTab, setPreviewTab] = useState<number | null>(null);
  const [localLegibility, setLocalLegibility] = useState<AdaptiveLegibilityResult | null>(null);

  const polarityStateRef = useRef<PolarityStabilityState>({
    committed: null,
    candidate: null,
    candidateSince: null,
  });

  const useHic = Boolean(stage.hicBridge);
  const frostOnly = stage.tier === "frost" || config.engine === "frost";
  const isRefractingLoupe = config.activePill === "refracting-loupe";
  const loupeLifted = isRefractingLoupe && (scrubbing || barPressed || parkedLoupe);
  const useContentPath =
    !useHic &&
    !frostOnly &&
    isRefractingLoupe &&
    (stage.tier === "svg-content" || config.engine === "svg-content");

  const pillDeform = useMemo(
    () => glassDeformationForSize(84, 50, config.pressCompression),
    [config.pressCompression],
  );

  // Tier 1 / Tier 2 main bar glass (0 bakes in Tier 0 WebGL2; static SVG filter scale during springs)
  const { diag: barDiag } = useLiquidGlass(pillRef, svgRef, config, {
    role: "surface",
    enabled: !useHic,
    frostOnly,
  });

  // Tier 1 / Tier 2 lifted floating loupe
  const { diag: loupeDiag } = useLiquidGlass(loupeRef, svgRef, config, {
    role: "loupe",
    enabled: !useHic && isRefractingLoupe,
    contentPath: useContentPath,
    frostOnly,
    scaleMultiplier: 1.0,
    blurOverride: 0,
    tintAlphaOverride: Math.min(0.04, config.tintAlpha * 0.25),
  });

  useEffect(() => {
    polarityStateRef.current = {
      committed: config.foreground,
      candidate: null,
      candidateSince: null,
    };
  }, [config.foreground]);

  const { reportLegibility, layoutVersion: stageLayoutVersion, requestChromePaint } = stage;

  // Live scroll-adaptive WCAG AA legibility sampler (skipped during active pointer scrubs & spring flights)
  const runLegibilitySample = useCallback(() => {
    if (flyingRef.current) return;
    const barEl = pillRef.current;
    if (!barEl) return;
    const { polaritySamples, contrastSamples } = sampleBackdropBehind(barEl, wrapRef.current);
    if (contrastSamples.length === 0) return;

    const baseTintRgb: SRGB = [config.tintColor.r, config.tintColor.g, config.tintColor.b];
    const prevPol = polarityStateRef.current.committed ?? config.foreground;
    const solved = solveAdaptiveLegibility(contrastSamples, {
      baseTintAlpha: config.tintAlpha,
      baseTintRgb,
      polaritySamples,
      previousPolarity: prevPol,
      forcedPolarity: config.adaptiveContrast ? undefined : config.foreground,
    });

    let nextRes = solved;
    if (config.adaptiveContrast) {
      const obs = stabilizePolarity(
        polarityStateRef.current,
        solved.polarity,
        performance.now(),
        DEFAULT_POLARITY_DWELL_MS,
      );
      polarityStateRef.current = obs.state;
      const committed = obs.state.committed ?? prevPol;
      if (committed !== solved.polarity) {
        nextRes = solveAdaptiveLegibility(contrastSamples, {
          baseTintAlpha: config.tintAlpha,
          baseTintRgb: committed === "light" ? [12, 16, 26] : [250, 251, 254],
          polaritySamples,
          forcedPolarity: committed,
        });
      }
    }

    setLocalLegibility((prev) =>
      prev &&
      prev.polarity === nextRes.polarity &&
      Math.abs(prev.scrimAlpha - nextRes.scrimAlpha) < 0.015 &&
      Math.abs(prev.worstContrast - nextRes.worstContrast) < 0.2
        ? prev
        : nextRes,
    );
    reportLegibility(nextRes);
  }, [
    config.adaptiveContrast,
    config.foreground,
    config.tintAlpha,
    config.tintColor,
    reportLegibility,
  ]);

  useEffect(() => {
    if (scrubbing) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        runLegibilitySample();
      });
    };
    schedule();
    const scrollHost = document.querySelector<HTMLElement>('[data-lgw-scroll-container="true"]');
    window.addEventListener("scroll", schedule, { passive: true });
    scrollHost?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const interval = window.setInterval(schedule, 420);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      scrollHost?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.clearInterval(interval);
    };
  }, [runLegibilitySample, size, useHic, scrubbing, stageLayoutVersion]);

  // Analytical Tier 0 Float32 diagnostics (0 ms PNG bakes)
  const hicDiagnostics = useMemo<{
    bar: LiquidGlassDiagnostics;
    loupe: LiquidGlassDiagnostics;
  } | null>(() => {
    if (!useHic) return null;
    const dprVal = typeof window !== "undefined" ? Math.min(3, window.devicePixelRatio || 1) : 2;
    const barR = size === "text" ? 27 : size === "icons" ? 28 : 30;
    const loupeR = size === "text" ? 29 : size === "icons" ? 30 : 33;
    const barStats = buildClampTable({
      profile: config.profile,
      bezel: Math.min(config.bezel, barR),
      thickness: config.thickness,
      ior: config.ior,
      minJacobian: config.minJacobian,
      maxMultiplier:
        Math.max(1, config.strength) *
        (config.pressCompression ? GLASS_PHYSICS.pressOpticalGain : 1),
    });
    const blueFactor = config.loupeDispersion > 0.01 ? maxSpectralFactor(config.loupeDispersion) : 1;
    const loupeStats = buildClampTable({
      profile: config.profile,
      bezel: Math.min(config.loupeBezel, loupeR),
      thickness: config.loupeThickness,
      ior: config.ior,
      minJacobian: config.minJacobian,
      maxMultiplier:
        Math.max(1, config.loupeStrength) *
        (config.pressCompression ? GLASS_PHYSICS.pressOpticalGain : 1) *
        blueFactor,
    });
    const delta = spectralDelta(config.loupeDispersion);
    const totalSpan = SPECTRAL_BANDS[SPECTRAL_BANDS.length - 1].offset - SPECTRAL_BANDS[0].offset;
    const spreadPx = loupeStats.dMax * Math.max(0, config.loupeStrength) * totalSpan * delta;
    return {
      bar: {
        engine: "html-in-canvas",
        dpr: dprVal,
        width: 354,
        height: barR * 2,
        radius: barR,
        bezel: Math.min(config.bezel, barR),
        dMax: barStats.dMax,
        rawMinJacobian: barStats.rawMinJacobian,
        clampedMinJacobian: barStats.clampedMinJacobian,
        foldClamped: barStats.folded,
        scale: 2 * barStats.dMax * config.strength,
        spectralSpreadPx: 0,
        bakeMs: 0,
      },
      loupe: {
        engine: "html-in-canvas",
        dpr: dprVal,
        width: size === "icons" ? 72 : 96,
        height: loupeR * 2,
        radius: loupeR,
        bezel: Math.min(config.loupeBezel, loupeR),
        dMax: loupeStats.dMax,
        rawMinJacobian: loupeStats.rawMinJacobian,
        clampedMinJacobian: loupeStats.clampedMinJacobian,
        foldClamped: loupeStats.folded,
        scale: 2 * loupeStats.dMax * config.loupeStrength,
        spectralSpreadPx: spreadPx,
        bakeMs: 0,
      },
    };
  }, [useHic, size, config]);

  const activeLegibility = localLegibility ?? stage.legibility;

  useEffect(() => {
    onDiagnostics?.({
      bar: hicDiagnostics ? hicDiagnostics.bar : barDiag,
      loupe: isRefractingLoupe ? (hicDiagnostics ? hicDiagnostics.loupe : loupeDiag) : null,
      legibility: activeLegibility,
    });
  }, [hicDiagnostics, barDiag, loupeDiag, isRefractingLoupe, activeLegibility, onDiagnostics]);

  const live = useRef({
    cx: 0,
    w: 84,
    h: 50,
    trackLeft: 6,
    lift: 0,
    stretchX: 1,
    stretchY: 1,
    pressGain: 1,
    touchX: 0,
    touchY: 0,
    touchGlow: 0,
  });

  const anims = useRef<AnimationPlaybackControls[]>([]);
  const flyingRef = useRef(false);
  const barGlowAnim = useRef<AnimationPlaybackControls | null>(null);
  const releaseVelocityRef = useRef(0);
  const wasLiftedRef = useRef(false);
  const liftedByDragOrParkRef = useRef(false);
  const lastSourceRef = useRef<InteractionSource>("pointer");

  const scrubRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    grabOffsetX: 0,
    moved: false,
    lastX: 0,
    lastTime: 0,
    vxPxPerSec: 0,
    targetIdx: activeIdx,
  });

  const cutoutMaskUrl = useMemo(() => {
    const w = size === "icons" ? 72 : 96;
    const h = size === "icons" ? 60 : size === "text" ? 58 : 66;
    return buildLoupeCutoutMask(w, h);
  }, [size]);

  const measureTab = useCallback((idx: number) => {
    const btn = tabRefs.current[idx];
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!btn || !wrap || !track) return null;
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    return {
      cx: btnRect.left - wrapRect.left + btnRect.width / 2,
      w: btn.offsetWidth,
      h: btn.offsetHeight,
      trackLeft: trackRect.left - wrapRect.left,
    };
  }, []);

  const paintIndicators = useCallback(() => {
    const { cx, w, h, trackLeft, lift, stretchX, stretchY, pressGain, touchX, touchY, touchGlow } =
      live.current;

    const loupe = loupeRef.current;
    const pill = pillRef.current;
    const loupeW = loupe?.offsetWidth || 96;
    const loupeH = loupe?.offsetHeight || 66;
    const barW = pill?.offsetWidth || 354;
    const barH = pill?.offsetHeight || 62;

    const restSx = w / loupeW;
    const restSy = h / loupeH;
    const safeLift = Math.max(-0.08, lift);
    const sx = (restSx + (1 - restSx) * safeLift) * stretchX;
    const sy = (restSy + (1 - restSy) * safeLift) * stretchY;

    const loupeOpacity = stage.reducedMotion
      ? lift > 0.5
        ? 1
        : 0
      : smoothstep(HANDOFF_LO, HANDOFF_HI * 0.85, lift);
    const thumbOpacity = stage.reducedMotion
      ? lift > 0.5
        ? 0
        : 1
      : 1 - smoothstep(0, HANDOFF_HI, lift);

    if (loupe) {
      loupe.style.transform = `translate3d(${cx.toFixed(2)}px, 0, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      loupe.style.opacity = loupeOpacity.toFixed(3);
    }

    const ghostBar = ghostBarRef.current;
    if (ghostBar && useContentPath) {
      ghostBar.style.width = `${barW}px`;
      ghostBar.style.height = `${barH}px`;
      const offsetX = -(cx - loupeW / 2);
      const offsetY = (loupeH - barH) / 2;
      ghostBar.style.transform = `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0)`;
    }

    const track = trackRef.current;
    if (track) {
      if (useContentPath && loupeOpacity > 0.15) {
        const mw = CUTOUT_W * sx;
        const mh = CUTOUT_H * sy;
        const mx = cx - trackLeft - mw / 2;
        const my = h / 2 - mh / 2;
        if (track.dataset.lgwCutout !== cutoutMaskUrl) {
          track.dataset.lgwCutout = cutoutMaskUrl;
          track.style.maskImage = cutoutMaskUrl;
          track.style.webkitMaskImage = cutoutMaskUrl;
          track.style.maskMode = "luminance";
          track.style.maskRepeat = "no-repeat";
          track.style.webkitMaskRepeat = "no-repeat";
        }
        track.style.maskSize = `${mw.toFixed(1)}px ${mh.toFixed(1)}px`;
        track.style.webkitMaskSize = `${mw.toFixed(1)}px ${mh.toFixed(1)}px`;
        track.style.maskPosition = `${mx.toFixed(1)}px ${my.toFixed(1)}px`;
        track.style.webkitMaskPosition = `${mx.toFixed(1)}px ${my.toFixed(1)}px`;
      } else if (track.dataset.lgwCutout) {
        delete track.dataset.lgwCutout;
        track.style.maskImage = "";
        track.style.webkitMaskImage = "";
      }
    }

    const refrProgress = clamp01(lift);
    const effGain = 1 + (pressGain - 1) * refrProgress;

    const restThumb = restThumbRef.current;
    const thumbSx = (loupeW * sx) / Math.max(1, w);
    const thumbSy = (loupeH * sy) / Math.max(1, h);
    if (restThumb) {
      const thumbLeft = cx - trackLeft - w / 2;
      restThumb.style.width = `${w.toFixed(2)}px`;
      restThumb.style.transform = `translate3d(${thumbLeft.toFixed(2)}px, 0, 0) scale(${thumbSx.toFixed(4)}, ${thumbSy.toFixed(4)})`;
      restThumb.style.opacity = thumbOpacity.toFixed(3);
    }

    if (stage.hicBridge && pill && wrapRef.current) {
      const barRect = pill.getBoundingClientRect();
      const wrapRect = wrapRef.current.getBoundingClientRect();
      const barCy = barRect.top + barRect.height / 2;
      const loupeViewportX = wrapRect.left + cx;
      const loupeViewportY = wrapRect.top + wrapRect.height / 2;
      const glowX = touchX || loupeViewportX;
      const glowY = touchY || barCy;
      const activeGlow = config.interactive ? touchGlow : 0;

      stage.hicBridge.upsertSurface(`tabbar-${instanceId}`, {
        kind: "glass",
        morphGroup: container.morphGroup,
        mergeK: container.mergeRadius,
        applyScrim: true,
        cx: barRect.left + barRect.width / 2,
        cy: barCy,
        w: barRect.width,
        h: barRect.height,
        radius: Math.min(barRect.width, barRect.height) / 2,
        pillCx: loupeViewportX,
        pillCy: barCy,
        pillW: w * thumbSx,
        pillH: h * thumbSy,
        pillAlpha: thumbOpacity,
        touchX: glowX,
        touchY: glowY,
        // Attenuate Pass-1 glow while Pass-2 loupe is active so both never compound into haze
        touchGlow: activeGlow * (1 - (isRefractingLoupe ? loupeOpacity * 0.85 : 0)),
        touchRadius: pillDeform.touchGlowRadius,
      });

      stage.hicBridge.upsertLoupe(`tabbar-loupe-${instanceId}`, {
        cx: loupeViewportX,
        cy: loupeViewportY,
        nativeW: loupeW,
        nativeH: loupeH,
        scaleX: sx,
        scaleY: sy,
        alpha: isRefractingLoupe ? loupeOpacity : 0,
        pressGain: effGain,
        touchX: glowX,
        touchY: glowY,
        touchGlow: activeGlow,
        touchRadius: pillDeform.touchGlowRadius,
      });
    }
  }, [
    config.interactive,
    container.mergeRadius,
    container.morphGroup,
    cutoutMaskUrl,
    instanceId,
    isRefractingLoupe,
    pillDeform.touchGlowRadius,
    stage.hicBridge,
    stage.reducedMotion,
    useContentPath,
  ]);

  const stopAnims = useCallback(() => {
    for (const c of anims.current) c.stop();
    anims.current = [];
    flyingRef.current = false;
  }, []);

  const animateBarTouchGlow = useCallback(
    (target: number) => {
      if (!config.interactive) return;
      barGlowAnim.current?.stop();
      if (stage.reducedMotion) {
        live.current.touchGlow = target > 0.5 ? 0.6 : 0;
        paintIndicators();
        return;
      }
      barGlowAnim.current = animate(live.current.touchGlow, target, {
        ...GLASS_SPRINGS.micro,
        onUpdate: (v) => {
          live.current.touchGlow = v;
          paintIndicators();
        },
      });
    },
    [config.interactive, paintIndicators, stage.reducedMotion],
  );

  useEffect(() => {
    if (!stage.hicBridge) return;
    paintIndicators();
    const raf = requestAnimationFrame(paintIndicators);
    const onResize = () => paintIndicators();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      stage.hicBridge?.removeSurface(`tabbar-${instanceId}`);
      stage.hicBridge?.removeLoupe(`tabbar-loupe-${instanceId}`);
    };
  }, [stage.hicBridge, stage.layoutVersion, instanceId, paintIndicators]);

  useEffect(
    () => () => {
      stopAnims();
      barGlowAnim.current?.stop();
    },
    [stopAnims],
  );

  const springToTarget = useCallback(
    (
      targetCx: number,
      targetW: number,
      targetH: number,
      trackLeft: number,
      lifted: boolean,
      instant = false,
      releaseVelocity = 0,
    ) => {
      const targetLift = lifted ? 1.0 : 0.0;
      const targetPress =
        lifted && config.pressCompression && !stage.reducedMotion
          ? pillDeform.pressOpticalGain
          : 1.0;
      const startCx = live.current.cx;
      const startLift = live.current.lift;
      const travelDist = Math.abs(targetCx - startCx);
      const fromDragOrPark = liftedByDragOrParkRef.current;
      const settlingFromLift = !lifted && (wasLiftedRef.current || startLift > 0.08);
      const transitionMode = resolveGlassTransitionMode(lastSourceRef.current, stage.reducedMotion);

      const tapFlightPulse =
        transitionMode === "full-liquid" &&
        !lifted &&
        isRefractingLoupe &&
        travelDist > 24 &&
        !fromDragOrPark &&
        !instant;

      wasLiftedRef.current = lifted;
      if (lifted && (scrubRef.current.moved || parkedLoupe)) {
        liftedByDragOrParkRef.current = true;
      } else if (!lifted) {
        liftedByDragOrParkRef.current = false;
      }

      live.current.trackLeft = trackLeft;
      live.current.h = targetH;
      stopAnims();

      if (instant || transitionMode === "instant") {
        live.current.cx = targetCx;
        live.current.w = targetW;
        live.current.lift = targetLift;
        live.current.stretchX = 1;
        live.current.stretchY = 1;
        live.current.pressGain = targetPress;
        paintIndicators();
        return;
      }

      const hasMomentum = Math.abs(releaseVelocity) > 40;
      const posSpring = hasMomentum
        ? { ...GLASS_SPRINGS.interactive, velocity: releaseVelocity }
        : settlingFromLift && !tapFlightPulse
          ? GLASS_SPRINGS.loupeSettle
          : GLASS_SPRINGS.snappy;
      const liftSpring = lifted ? GLASS_SPRINGS.loupeLift : GLASS_SPRINGS.loupeSettle;

      if (tapFlightPulse) {
        flyingRef.current = true;
        const startW = live.current.w;
        const peakLift = Math.max(
          startLift,
          travelDist > 130 ? TAP_LOUPE_PEAK_FAR : TAP_LOUPE_PEAK_NEAR,
        );
        anims.current = [
          animate(startCx, targetCx, {
            ...GLASS_SPRINGS.snappy,
            onUpdate: (v) => {
              live.current.cx = v;
              const p = clamp01(1 - Math.abs(targetCx - v) / Math.max(1, travelDist));
              const bell = tapFlightBell(p, 0.85);
              const carry = startLift * (1 - p);
              live.current.w = startW + (targetW - startW) * p;
              live.current.lift = Math.max(carry, peakLift * bell);
              live.current.stretchX = 1 + pillDeform.maxVelocityStretch * bell;
              live.current.stretchY =
                1 - pillDeform.maxVelocityStretch * pillDeform.crossAxisRatio * bell;
              live.current.pressGain = 1;
              paintIndicators();
            },
            onComplete: () => {
              flyingRef.current = false;
              live.current.cx = targetCx;
              live.current.w = targetW;
              live.current.lift = 0;
              live.current.stretchX = 1;
              live.current.stretchY = 1;
              paintIndicators();
            },
          }),
        ];
        return;
      }

      anims.current = [
        animate(live.current.cx, targetCx, {
          ...posSpring,
          onUpdate: (v) => {
            live.current.cx = v;
            paintIndicators();
          },
        }),
        animate(live.current.w, targetW, {
          ...GLASS_SPRINGS.snappy,
          onUpdate: (v) => {
            live.current.w = v;
            paintIndicators();
          },
        }),
        animate(live.current.lift, targetLift, {
          ...liftSpring,
          onUpdate: (v) => {
            live.current.lift = v;
            paintIndicators();
          },
        }),
        animate(live.current.pressGain, targetPress, {
          ...liftSpring,
          onUpdate: (v) => {
            live.current.pressGain = v;
            paintIndicators();
          },
        }),
        animate(live.current.stretchX, 1, {
          ...GLASS_SPRINGS.snappy,
          onUpdate: (v) => {
            live.current.stretchX = v;
            paintIndicators();
          },
        }),
        animate(live.current.stretchY, 1, {
          ...GLASS_SPRINGS.snappy,
          onUpdate: (v) => {
            live.current.stretchY = v;
            paintIndicators();
          },
        }),
      ];
    },
    [
      config.pressCompression,
      isRefractingLoupe,
      paintIndicators,
      parkedLoupe,
      pillDeform.crossAxisRatio,
      pillDeform.maxVelocityStretch,
      pillDeform.pressOpticalGain,
      stage.reducedMotion,
      stopAnims,
    ],
  );

  const syncIndicators = useCallback(
    (instant: boolean) => {
      const vel = releaseVelocityRef.current;
      releaseVelocityRef.current = 0;

      if (parkedLoupe && isRefractingLoupe && items.length >= 2) {
        const m0 = measureTab(0);
        const m1 = measureTab(1);
        if (m0 && m1) {
          springToTarget((m0.cx + m1.cx) / 2, m0.w, m0.h, m0.trackLeft, true, instant, 0);
          return;
        }
      }
      const m = measureTab(activeIdx);
      if (m) springToTarget(m.cx, m.w, m.h, m.trackLeft, loupeLifted, instant, vel);
    },
    [parkedLoupe, isRefractingLoupe, items.length, measureTab, activeIdx, loupeLifted, springToTarget],
  );

  useLayoutEffect(() => {
    syncIndicators(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, isRefractingLoupe, useContentPath, items.length]);

  useEffect(() => {
    if (!scrubRef.current.active) {
      syncIndicators(false);
    }
  }, [activeIdx, loupeLifted, parkedLoupe, syncIndicators]);

  const syncIndicatorsRef = useRef(syncIndicators);
  useEffect(() => {
    syncIndicatorsRef.current = syncIndicators;
  }, [syncIndicators]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let prevW = wrap.offsetWidth;
    let prevH = wrap.offsetHeight;
    const ro = new ResizeObserver(() => {
      const nextW = wrap.offsetWidth;
      const nextH = wrap.offsetHeight;
      if (Math.abs(nextW - prevW) < 0.5 && Math.abs(nextH - prevH) < 0.5) return;
      prevW = nextW;
      prevH = nextH;
      if (!scrubRef.current.active) syncIndicatorsRef.current(true);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const nearestTabIndex = useCallback(
    (localCx: number) => {
      let nearest = activeIdx;
      let bestDist = Infinity;
      for (let i = 0; i < items.length; i++) {
        const m = measureTab(i);
        if (!m) continue;
        const dist = Math.abs(localCx - m.cx);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = i;
        }
      }
      return nearest;
    },
    [activeIdx, items.length, measureTab],
  );

  const onTrackKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (activeIdx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (activeIdx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    lastSourceRef.current = "keyboard";
    onChange(items[next].id);
    tabRefs.current[next]?.focus();
  };

  const onTrackPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    lastSourceRef.current = "pointer";
    const wrap = wrapRef.current;
    const localX = wrap ? e.clientX - wrap.getBoundingClientRect().left : live.current.cx;
    live.current.touchX = e.clientX;
    live.current.touchY = e.clientY;
    animateBarTouchGlow(1);
    setBarPressed(true);
    const deltaFromLoupe = live.current.cx - localX;
    scrubRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      grabOffsetX:
        live.current.lift > 0.25 && Math.abs(deltaFromLoupe) <= 64 ? deltaFromLoupe : 0,
      moved: false,
      lastX: e.clientX,
      lastTime: performance.now(),
      vxPxPerSec: 0,
      targetIdx: activeIdx,
    };
  };

  const onTrackPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = scrubRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    const track = trackRef.current;
    const wrap = wrapRef.current;
    if (!track || !wrap || items.length === 0) return;

    live.current.touchX = e.clientX;
    live.current.touchY = e.clientY;

    const dx = e.clientX - s.startX;
    if (!s.moved && Math.abs(dx) > 4) {
      s.moved = true;
      setScrubbing(true);
      track.setPointerCapture(e.pointerId);
      stopAnims();
      if (!stage.reducedMotion && live.current.lift < 0.99) {
        anims.current = [
          animate(live.current.lift, 1.0, {
            ...GLASS_SPRINGS.loupeLift,
            onUpdate: (v) => {
              live.current.lift = v;
              paintIndicators();
            },
          }),
          animate(live.current.pressGain, pillDeform.pressOpticalGain, {
            ...GLASS_SPRINGS.loupeLift,
            onUpdate: (v) => {
              live.current.pressGain = v;
              paintIndicators();
            },
          }),
        ];
      } else {
        live.current.lift = 1.0;
        live.current.pressGain = stage.reducedMotion ? 1.0 : pillDeform.pressOpticalGain;
      }
    }
    if (!s.moved) return;

    const wrapRect = wrap.getBoundingClientRect();
    const rawCx = e.clientX - wrapRect.left + s.grabOffsetX;

    const firstM = measureTab(0);
    const lastM = measureTab(items.length - 1);
    if (!firstM || !lastM) return;

    const clampedCx =
      rawCx < firstM.cx
        ? firstM.cx + rubberband(rawCx - firstM.cx, GLASS_PHYSICS.tabRubberbandDim)
        : rawCx > lastM.cx
          ? lastM.cx + rubberband(rawCx - lastM.cx, GLASS_PHYSICS.tabRubberbandDim)
          : rawCx;

    const nearest = nearestTabIndex(clampedCx);
    const nearestM = measureTab(nearest);
    if (!nearestM) return;
    s.targetIdx = nearest;
    setPreviewTab(nearest);

    const now = performance.now();
    const dt = Math.max(8, now - s.lastTime);
    const vxPxPerMs = (e.clientX - s.lastX) / dt;
    s.vxPxPerSec = Math.max(
      -GLASS_PHYSICS.maxReleaseVelocity,
      Math.min(GLASS_PHYSICS.maxReleaseVelocity, vxPxPerMs * 1000),
    );
    const stretch =
      stage.reducedMotion || !config.interactive
        ? 0
        : velocityStretch(vxPxPerMs, pillDeform.maxVelocityStretch);
    s.lastX = e.clientX;
    s.lastTime = now;

    live.current.cx = clampedCx;
    live.current.w = nearestM.w;
    live.current.h = nearestM.h;
    live.current.trackLeft = nearestM.trackLeft;
    live.current.stretchX = 1 + stretch;
    live.current.stretchY = 1 - stretch * pillDeform.crossAxisRatio;
    paintIndicators();
  };

  const finishScrub = (e: PointerEvent<HTMLDivElement>) => {
    const s = scrubRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    const wasMoved = s.moved;
    const vx = wasMoved ? s.vxPxPerSec : 0;
    const projectedCx = live.current.cx + (wasMoved ? projectMomentum(vx) : 0);
    const chosen = wasMoved ? nearestTabIndex(projectedCx) : s.targetIdx;

    s.active = false;
    s.moved = false;
    s.vxPxPerSec = 0;
    releaseVelocityRef.current = vx;
    setBarPressed(false);
    setScrubbing(false);
    setPreviewTab(null);
    animateBarTouchGlow(0);

    if (wasMoved && items[chosen]) {
      onChange(items[chosen].id);
    }
  };

  useEffect(() => {
    if (useHic) {
      requestChromePaint();
    }
  }, [useHic, requestChromePaint, activeIdx, previewTab, size]);

  const shownTab = previewTab ?? activeIdx;
  const scrimStyle: CSSProperties =
    config.adaptiveContrast && activeLegibility
      ? {
          backgroundColor: `rgb(${activeLegibility.scrimRgb[0]} ${activeLegibility.scrimRgb[1]} ${activeLegibility.scrimRgb[2]})`,
          opacity: activeLegibility.scrimAlpha > 0.005 ? activeLegibility.scrimAlpha : 0,
        }
      : { opacity: 0 };

  return (
    <div
      ref={wrapRef}
      className={className ? `lgw-tabbar-wrap ${className}` : "lgw-tabbar-wrap"}
      style={style}
    >
      {!hasStageSvg && (
        <svg ref={localSvgRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />
      )}

      <div
        ref={pillRef}
        className={`lgw-glass-surface lgw-tabbar lgw-tabbar--${size}${scrubbing ? " is-scrubbing" : ""}`}
        role="tablist"
        aria-label={ariaLabel}
      >
        <div className="lgw-scrim" style={scrimStyle} aria-hidden="true" />

        <div
          ref={trackRef}
          className="lgw-tabbar__track"
          onKeyDown={onTrackKeyDown}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={finishScrub}
          onPointerCancel={finishScrub}
        >
          <div
            ref={restThumbRef}
            className={`lgw-tabbar__thumb lgw-tabbar__thumb--${config.activePill}`}
            aria-hidden="true"
          />

          {items.map((tab, idx) => {
            const isActive = idx === shownTab;
            const isSelected = idx === activeIdx;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-label={tab.ariaLabel ?? tab.label}
                className={`lgw-tab${isActive ? " is-active" : ""}${config.activePill === "ink" && isActive ? " is-inverted" : ""}`}
                onClick={() => {
                  lastSourceRef.current = "pointer";
                  onChange(tab.id);
                }}
              >
                {size !== "text" && tab.icon !== undefined && (
                  <span className="lgw-tab__icon" aria-hidden="true">
                    {renderTabIcon(tab.icon, isActive)}
                  </span>
                )}
                {size !== "icons" && <span className="lgw-tab__label">{tab.label}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {isRefractingLoupe && (
        <div
          ref={loupeRef}
          className={`lgw-glass-surface lgw-loupe lgw-loupe--${size}${loupeLifted ? " is-lifted" : ""}${useContentPath ? " is-aave-content" : ""}`}
          aria-hidden="true"
        >
          {useContentPath && (
            <div className="lgw-loupe__content-clip" aria-hidden="true">
              <div
                ref={ghostBarRef}
                className={`lgw-loupe__ghost-bar lgw-tabbar--${size}`}
                aria-hidden="true"
                inert
              >
                <div className="lgw-tabbar__track">
                  {items.map((tab, idx) => {
                    const isActive = idx === shownTab;
                    return (
                      <div
                        key={tab.id}
                        className={`lgw-tab${isActive ? " is-active" : ""}${config.activePill === "ink" && isActive ? " is-inverted" : ""}`}
                      >
                        {size !== "text" && tab.icon !== undefined && (
                          <span className="lgw-tab__icon">
                            {renderTabIcon(tab.icon, isActive)}
                          </span>
                        )}
                        {size !== "icons" && <span className="lgw-tab__label">{tab.label}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
