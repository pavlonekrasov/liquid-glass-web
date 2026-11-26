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
} from "react";
import { animate, type AnimationPlaybackControls } from "motion/react";
import {
  clamp01,
  GLASS_PHYSICS,
  GLASS_SPRINGS,
  glassDeformationForSize,
  resolveGlassTransitionMode,
  rubberband,
  smoothstep,
  velocityStretch,
  type InteractionSource,
} from "../core/motion.ts";
import {
  resolveGlassConfig,
  type GlassMaterialProps,
  type ResolvedGlassConfig,
} from "../core/presets.ts";
import { useLiquidGlass } from "../engines/useLiquidGlass.ts";
import { useGlassStage } from "../primitives/context.tsx";

const TRACK_W = 156;
const TRACK_H = 6;
const THUMB_W = 32;
const THUMB_H = 20;
const LOUPE_W = 46;
const LOUPE_H = 32;
const MIN_CX = THUMB_W / 2;
const MAX_CX = TRACK_W - THUMB_W / 2;
const TRAVEL_X = MAX_CX - MIN_CX;

const HANDOFF_HI = 0.36;
const HANDOFF_LO = 0.04;

export interface GlassSliderProps extends GlassMaterialProps {
  /** Slider value in [min, max] (defaults to normalized [0, 1]). */
  readonly value: number;
  readonly onValueChange: (next: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly "aria-label"?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Glass slider (role="slider"). The thumb rests as a white pill and lifts into a
 * refracting bead while you drag.
 */
export function GlassSlider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step,
  "aria-label": ariaLabel = "Slider",
  disabled = false,
  variant,
  shapeProfile,
  refraction,
  dispersion,
  frost,
  interactive,
  adaptiveContrast,
  engine,
  optics,
  className,
  style,
}: GlassSliderProps) {
  const stage = useGlassStage();
  const instanceId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const ghostTrackRef = useRef<HTMLDivElement>(null);
  const ghostFillRef = useRef<HTMLDivElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);

  const { hasStageSvg } = stage;
  const svgRef = hasStageSvg ? stage.svgHostRef : localSvgRef;

  const span = Math.max(1e-6, max - min);
  const normalized = clamp01((value - min) / span);
  const emitNormalized = useCallback(
    (norm: number) => {
      let next = min + clamp01(norm) * span;
      if (step && step > 0) {
        next = Math.round((next - min) / step) * step + min;
      }
      onValueChange(Math.min(max, Math.max(min, Number(next.toFixed(6)))));
    },
    [max, min, onValueChange, span, step],
  );

  const [pressed, setPressed] = useState(false);

  const baseConfig = useMemo(
    () =>
      resolveGlassConfig(
        {
          variant,
          shapeProfile,
          refraction,
          dispersion,
          frost,
          interactive,
          adaptiveContrast,
          engine,
          optics,
        },
        stage.config,
      ),
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
      stage.config,
    ],
  );

  const useHic = Boolean(stage.hicBridge);
  const frostOnly = stage.tier === "frost" || baseConfig.engine === "frost";
  const useContentPath =
    !useHic && !frostOnly && (stage.tier === "svg-content" || baseConfig.engine === "svg-content");

  const deform = useMemo(
    () => glassDeformationForSize(THUMB_W, THUMB_H, baseConfig.pressCompression),
    [baseConfig.pressCompression],
  );

  const sliderConfig = useMemo<ResolvedGlassConfig>(
    () => ({
      ...baseConfig,
      loupeBezel: Math.min(10, baseConfig.loupeBezel),
      loupeThickness: Math.min(15, baseConfig.loupeThickness),
      loupeDispersion: baseConfig.loupeDispersion * 0.85,
      edgeRingAlpha: Math.max(0.14, baseConfig.edgeRingAlpha),
      edgeRingLight: true,
    }),
    [baseConfig],
  );

  useLiquidGlass(loupeRef, svgRef, sliderConfig, {
    role: "loupe",
    enabled: !useHic,
    contentPath: useContentPath,
    frostOnly,
    scaleMultiplier: 1.0,
    blurOverride: 0,
    tintAlphaOverride: 0.03,
  });

  const live = useRef({
    cx: MIN_CX + normalized * TRAVEL_X,
    fill: normalized,
    lift: 0,
    stretchX: 1,
    stretchY: 1,
    touchX: 0,
    touchY: 0,
    touchGlow: 0,
  });
  const anims = useRef<AnimationPlaybackControls[]>([]);
  const glowAnim = useRef<AnimationPlaybackControls | null>(null);
  const lastSourceRef = useRef<InteractionSource>("pointer");

  const dragRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastTime: 0,
  });

  const paint = useCallback(() => {
    const { cx, fill, lift, stretchX, stretchY, touchX, touchY, touchGlow } = live.current;
    const restSx = THUMB_W / LOUPE_W;
    const restSy = THUMB_H / LOUPE_H;
    const safeLift = Math.max(-0.04, lift);
    const sx = (restSx + (1 - restSx) * safeLift) * stretchX;
    const sy = (restSy + (1 - restSy) * safeLift) * stretchY;

    const loupeOp = stage.reducedMotion ? 0 : smoothstep(HANDOFF_LO, HANDOFF_HI, lift);
    const thumbOp = stage.reducedMotion ? 1 : 1 - smoothstep(0.02, HANDOFF_HI * 0.9, lift);

    if (loupeRef.current) {
      loupeRef.current.style.transform = `translate3d(${cx.toFixed(2)}px, 0, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      loupeRef.current.style.opacity = loupeOp.toFixed(3);
    }

    const thumbSx = (LOUPE_W * sx) / THUMB_W;
    const thumbSy = (LOUPE_H * sy) / THUMB_H;
    if (thumbRef.current) {
      thumbRef.current.style.transform = `translate3d(${cx.toFixed(2)}px, 0, 0) scale(${thumbSx.toFixed(4)}, ${thumbSy.toFixed(4)})`;
      thumbRef.current.style.opacity = thumbOp.toFixed(3);
    }

    const fillPct = `${(clamp01(fill) * 100).toFixed(2)}%`;
    if (fillRef.current) fillRef.current.style.width = fillPct;

    if (ghostTrackRef.current && useContentPath) {
      const ox = -(cx - LOUPE_W / 2);
      const oy = (LOUPE_H - TRACK_H) / 2;
      ghostTrackRef.current.style.transform = `translate3d(${ox.toFixed(2)}px, ${oy.toFixed(2)}px, 0)`;
    }
    if (ghostFillRef.current && useContentPath) {
      ghostFillRef.current.style.width = fillPct;
    }

    if (stage.hicBridge && trackRef.current) {
      const r = trackRef.current.getBoundingClientRect();
      const knobViewportX = r.left + cx;
      const trackCy = r.top + r.height / 2;
      const glowX = touchX || knobViewportX;
      const glowY = touchY || trackCy;
      const activeGlow = baseConfig.interactive ? touchGlow : 0;

      stage.hicBridge.upsertSurface(`slider-${instanceId}`, {
        kind: "slider-track",
        cx: r.left + r.width / 2,
        cy: trackCy,
        w: TRACK_W,
        h: TRACK_H,
        radius: TRACK_H / 2,
        fill: clamp01(fill),
        knobCx: knobViewportX,
        knobW: THUMB_W,
        knobH: THUMB_H,
        knobScaleX: thumbSx,
        knobScaleY: thumbSy,
        knobAlpha: thumbOp,
        touchX: glowX,
        touchY: glowY,
        touchGlow: activeGlow,
        touchRadius: deform.touchGlowRadius,
      });

      stage.hicBridge.upsertLoupe(`slider-loupe-${instanceId}`, {
        cx: knobViewportX,
        cy: trackCy,
        nativeW: LOUPE_W,
        nativeH: LOUPE_H,
        scaleX: sx,
        scaleY: sy,
        alpha: loupeOp,
        pressGain: deform.pressOpticalGain,
        bezel: Math.min(10, baseConfig.loupeBezel),
        thickness: Math.min(15, baseConfig.loupeThickness),
        dispersionScale: 0.85,
        tintAlpha: 0.03,
        ringAlpha: Math.max(0.16, baseConfig.edgeRingAlpha + 0.04),
        touchX: glowX,
        touchY: glowY,
        touchGlow: activeGlow,
        touchRadius: deform.touchGlowRadius,
      });
    }
  }, [
    baseConfig.edgeRingAlpha,
    baseConfig.interactive,
    baseConfig.loupeBezel,
    baseConfig.loupeThickness,
    deform.pressOpticalGain,
    deform.touchGlowRadius,
    instanceId,
    stage.hicBridge,
    stage.reducedMotion,
    useContentPath,
  ]);

  const stopAnims = useCallback(() => {
    for (const c of anims.current) c.stop();
    anims.current = [];
  }, []);

  const animateTouchGlow = useCallback(
    (target: number) => {
      if (!baseConfig.interactive) return;
      glowAnim.current?.stop();
      if (stage.reducedMotion) {
        live.current.touchGlow = target > 0.5 ? 0.6 : 0;
        paint();
        return;
      }
      glowAnim.current = animate(live.current.touchGlow, target, {
        ...GLASS_SPRINGS.micro,
        onUpdate: (v) => {
          live.current.touchGlow = v;
          paint();
        },
      });
    },
    [baseConfig.interactive, paint, stage.reducedMotion],
  );

  useLayoutEffect(() => {
    live.current.cx = MIN_CX + normalized * TRAVEL_X;
    live.current.fill = normalized;
    live.current.lift = 0;
    live.current.stretchX = 1;
    live.current.stretchY = 1;
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useContentPath, useHic]);

  useEffect(() => {
    if (!stage.hicBridge) return;
    paint();
    const raf = requestAnimationFrame(paint);
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      stage.hicBridge?.removeSurface(`slider-${instanceId}`);
      stage.hicBridge?.removeLoupe(`slider-loupe-${instanceId}`);
    };
  }, [stage.hicBridge, stage.layoutVersion, instanceId, paint]);

  useEffect(() => {
    if (dragRef.current.active) return;

    const targetCx = MIN_CX + normalized * TRAVEL_X;
    const mode = resolveGlassTransitionMode(lastSourceRef.current, stage.reducedMotion);
    stopAnims();

    if (mode === "instant") {
      live.current.cx = targetCx;
      live.current.fill = normalized;
      live.current.lift = 0;
      live.current.stretchX = 1;
      live.current.stretchY = 1;
      paint();
      return;
    }

    if (pressed) {
      anims.current = [
        animate(live.current.lift, 1, {
          ...GLASS_SPRINGS.loupeLift,
          onUpdate: (v) => {
            live.current.lift = v;
            paint();
          },
        }),
      ];
      return;
    }

    const settleSpring =
      mode === "snappy-no-loupe" ? GLASS_SPRINGS.snappy : GLASS_SPRINGS.interactive;
    anims.current = [
      animate(live.current.cx, targetCx, {
        ...settleSpring,
        onUpdate: (v) => {
          live.current.cx = v;
          live.current.fill = clamp01((v - MIN_CX) / TRAVEL_X);
          paint();
        },
      }),
      animate(live.current.lift, 0, {
        ...GLASS_SPRINGS.loupeSettle,
        onUpdate: (v) => {
          live.current.lift = v;
          paint();
        },
      }),
      animate(live.current.stretchX, 1, {
        ...GLASS_SPRINGS.snappy,
        onUpdate: (v) => {
          live.current.stretchX = v;
          paint();
        },
      }),
      animate(live.current.stretchY, 1, {
        ...GLASS_SPRINGS.snappy,
        onUpdate: (v) => {
          live.current.stretchY = v;
          paint();
        },
      }),
    ];
  }, [normalized, pressed, stage.reducedMotion, paint, stopAnims]);

  useEffect(
    () => () => {
      stopAnims();
      glowAnim.current?.stop();
    },
    [stopAnims],
  );

  const updateFromClientX = (clientX: number, clientY: number, isMove: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    const r = track.getBoundingClientRect();
    const rawLocalX = clientX - r.left;

    const clampedCx =
      rawLocalX < MIN_CX
        ? MIN_CX + rubberband(rawLocalX - MIN_CX, GLASS_PHYSICS.controlRubberbandDim)
        : rawLocalX > MAX_CX
          ? MAX_CX + rubberband(rawLocalX - MAX_CX, GLASS_PHYSICS.controlRubberbandDim)
          : rawLocalX;

    const nextNorm = clamp01((rawLocalX - MIN_CX) / TRAVEL_X);

    if (isMove && !stage.reducedMotion && baseConfig.interactive) {
      const now = performance.now();
      const dt = Math.max(8, now - dragRef.current.lastTime);
      const vxPxPerMs = (clientX - dragRef.current.lastX) / dt;
      const stretch = velocityStretch(vxPxPerMs, deform.maxVelocityStretch);
      dragRef.current.lastX = clientX;
      dragRef.current.lastTime = now;
      live.current.stretchX = 1 + stretch;
      live.current.stretchY = 1 - stretch * deform.crossAxisRatio;
    }

    live.current.cx = clampedCx;
    live.current.fill = nextNorm;
    live.current.touchX = clientX;
    live.current.touchY = clientY;
    paint();
    emitNormalized(nextNorm);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    lastSourceRef.current = "pointer";
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    setPressed(true);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastTime: performance.now(),
    };
    stopAnims();
    live.current.touchX = e.clientX;
    live.current.touchY = e.clientY;
    animateTouchGlow(1);
    updateFromClientX(e.clientX, e.clientY, false);

    if (!stage.reducedMotion) {
      anims.current = [
        animate(live.current.lift, 1, {
          ...GLASS_SPRINGS.loupeLift,
          onUpdate: (v) => {
            live.current.lift = v;
            paint();
          },
        }),
      ];
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    updateFromClientX(e.clientX, e.clientY, true);
  };

  const finishPointer = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    d.active = false;
    setPressed(false);
    animateTouchGlow(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const baseStep = step ? step / span : 0.05;
    const delta = e.shiftKey ? baseStep * 2 : baseStep;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = clamp01(normalized + delta);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = clamp01(normalized - delta);
    else if (e.key === "PageUp") next = clamp01(normalized + 0.15);
    else if (e.key === "PageDown") next = clamp01(normalized - 0.15);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    if (next === null) return;
    e.preventDefault();
    lastSourceRef.current = "keyboard";
    emitNormalized(next);
  };

  const pct = Math.round(normalized * 100);

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={`${pct}%`}
      className={className ? `lgw-slider ${className}` : "lgw-slider"}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={onKeyDown}
    >
      {!hasStageSvg && (
        <svg ref={localSvgRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />
      )}
      <div ref={trackRef} className="lgw-slider__track" aria-hidden="true">
        <div ref={fillRef} className="lgw-slider__fill" />
      </div>

      <div ref={thumbRef} className="lgw-slider__thumb" aria-hidden="true" />

      <div ref={loupeRef} className="lgw-glass-surface lgw-slider__loupe" aria-hidden="true">
        {useContentPath && (
          <div className="lgw-slider__content-clip" aria-hidden="true">
            <div ref={ghostTrackRef} className="lgw-slider__ghost-track" aria-hidden="true">
              <div ref={ghostFillRef} className="lgw-slider__fill" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
