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
  tapFlightBell,
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

const TRACK_W = 64;
const TRACK_H = 30;
const THUMB_W = 36;
const THUMB_H = 24;
const LOUPE_W = 50;
const LOUPE_H = 38;
const OFF_CX = 3 + THUMB_W / 2;
const ON_CX = TRACK_W - 3 - THUMB_W / 2;
const TRAVEL_X = ON_CX - OFF_CX;

const HANDOFF_HI = 0.38;
const HANDOFF_LO = 0.04;

export interface GlassSwitchProps extends GlassMaterialProps {
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
  readonly "aria-label"?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Glass switch (role="switch"). The thumb rests as a white pill and lifts into a
 * refracting droplet on press or drag.
 */
export function GlassSwitch({
  checked,
  onCheckedChange,
  "aria-label": ariaLabel = "Toggle switch",
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
}: GlassSwitchProps) {
  const stage = useGlassStage();
  const instanceId = useId();
  const wrapRef = useRef<HTMLButtonElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackFillRef = useRef<HTMLDivElement>(null);
  const ghostTrackRef = useRef<HTMLDivElement>(null);
  const ghostFillRef = useRef<HTMLDivElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);

  const { hasStageSvg } = stage;
  const svgRef = hasStageSvg ? stage.svgHostRef : localSvgRef;

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

  const switchConfig = useMemo<ResolvedGlassConfig>(
    () => ({
      ...baseConfig,
      loupeBezel: Math.min(11, baseConfig.loupeBezel),
      loupeThickness: Math.min(16, baseConfig.loupeThickness),
      loupeDispersion: baseConfig.loupeDispersion * 0.85,
      edgeRingAlpha: Math.max(0.14, baseConfig.edgeRingAlpha),
      edgeRingLight: true,
    }),
    [baseConfig],
  );

  useLiquidGlass(loupeRef, svgRef, switchConfig, {
    role: "loupe",
    enabled: !useHic,
    contentPath: useContentPath,
    frostOnly,
    scaleMultiplier: 1.0,
    blurOverride: 0,
    tintAlphaOverride: 0.03,
  });

  const live = useRef({
    cx: checked ? ON_CX : OFF_CX,
    lift: 0,
    stretchX: 1,
    stretchY: 1,
    fill: checked ? 1 : 0,
    touchX: 0,
    touchY: 0,
    touchGlow: 0,
  });
  const anims = useRef<AnimationPlaybackControls[]>([]);
  const glowAnim = useRef<AnimationPlaybackControls | null>(null);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    originCx: OFF_CX,
    moved: false,
  });
  const draggedReleaseRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const lastSourceRef = useRef<InteractionSource>("pointer");

  const paint = useCallback(() => {
    const { cx, lift, stretchX, stretchY, fill, touchX, touchY, touchGlow } = live.current;
    const restSx = THUMB_W / LOUPE_W;
    const restSy = THUMB_H / LOUPE_H;
    const safeLift = Math.max(-0.05, lift);
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

    if (trackFillRef.current) {
      trackFillRef.current.style.opacity = clamp01(fill).toFixed(3);
    }

    if (ghostTrackRef.current && useContentPath) {
      const ox = -(cx - LOUPE_W / 2);
      const oy = (LOUPE_H - TRACK_H) / 2;
      ghostTrackRef.current.style.transform = `translate3d(${ox.toFixed(2)}px, ${oy.toFixed(2)}px, 0)`;
    }
    if (ghostFillRef.current && useContentPath) {
      ghostFillRef.current.style.opacity = clamp01(fill).toFixed(3);
    }

    if (stage.hicBridge && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      const trackCy = r.top + r.height / 2;
      const knobViewportX = r.left + cx;
      const glowX = touchX || knobViewportX;
      const glowY = touchY || trackCy;
      const activeGlow = baseConfig.interactive ? touchGlow : 0;

      stage.hicBridge.upsertSurface(`switch-${instanceId}`, {
        kind: "switch-track",
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

      stage.hicBridge.upsertLoupe(`switch-loupe-${instanceId}`, {
        cx: knobViewportX,
        cy: trackCy,
        nativeW: LOUPE_W,
        nativeH: LOUPE_H,
        scaleX: sx,
        scaleY: sy,
        alpha: loupeOp,
        pressGain: baseConfig.pressCompression ? 1.08 : 1,
        bezel: Math.min(11, baseConfig.loupeBezel),
        thickness: Math.min(16, baseConfig.loupeThickness),
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
    baseConfig.pressCompression,
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
    live.current.cx = checked ? ON_CX : OFF_CX;
    live.current.fill = checked ? 1 : 0;
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
      stage.hicBridge?.removeSurface(`switch-${instanceId}`);
      stage.hicBridge?.removeLoupe(`switch-loupe-${instanceId}`);
    };
  }, [stage.hicBridge, stage.layoutVersion, instanceId, paint]);

  useEffect(() => {
    if (dragRef.current.active) return;

    const targetCx = checked ? ON_CX : OFF_CX;
    const targetFill = checked ? 1 : 0;
    const startCx = live.current.cx;
    const startLift = live.current.lift;
    const dist = Math.abs(targetCx - startCx);
    const wasDragged = draggedReleaseRef.current;
    draggedReleaseRef.current = false;

    const transitionMode = resolveGlassTransitionMode(lastSourceRef.current, stage.reducedMotion);
    stopAnims();

    if (transitionMode === "instant") {
      live.current.cx = targetCx;
      live.current.fill = targetFill;
      live.current.lift = 0;
      live.current.stretchX = 1;
      live.current.stretchY = 1;
      paint();
      return;
    }

    if (pressed) {
      anims.current = [
        animate(startLift, 1, {
          ...GLASS_SPRINGS.loupeLift,
          onUpdate: (v) => {
            live.current.lift = v;
            paint();
          },
        }),
      ];
      return;
    }

    if (dist > 4 && !wasDragged && transitionMode === "full-liquid") {
      anims.current = [
        animate(startCx, targetCx, {
          ...GLASS_SPRINGS.snappy,
          onUpdate: (v) => {
            live.current.cx = v;
            const p = clamp01(1 - Math.abs(targetCx - v) / Math.max(1, dist));
            const bell = tapFlightBell(p, 0.8);
            live.current.lift = Math.max(startLift * (1 - p), 0.92 * bell);
            live.current.stretchX = 1 + deform.maxVelocityStretch * bell;
            live.current.stretchY = 1 - deform.maxVelocityStretch * deform.crossAxisRatio * bell;
            live.current.fill = clamp01((v - OFF_CX) / TRAVEL_X);
            paint();
          },
          onComplete: () => {
            live.current.cx = targetCx;
            live.current.lift = 0;
            live.current.stretchX = 1;
            live.current.stretchY = 1;
            live.current.fill = targetFill;
            paint();
          },
        }),
      ];
      return;
    }

    anims.current = [
      animate(startCx, targetCx, {
        ...GLASS_SPRINGS.snappy,
        onUpdate: (v) => {
          live.current.cx = v;
          live.current.fill = clamp01((v - OFF_CX) / TRAVEL_X);
          paint();
        },
      }),
      animate(startLift, 0, {
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
  }, [
    checked,
    pressed,
    stage.reducedMotion,
    deform.crossAxisRatio,
    deform.maxVelocityStretch,
    paint,
    stopAnims,
  ]);

  useEffect(
    () => () => {
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current);
      stopAnims();
      glowAnim.current?.stop();
    },
    [stopAnims],
  );

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    lastSourceRef.current = "pointer";
    suppressNextClickRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed(true);
    live.current.touchX = e.clientX;
    live.current.touchY = e.clientY;
    animateTouchGlow(1);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      lastX: e.clientX,
      lastTime: performance.now(),
      originCx: live.current.cx,
      moved: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    live.current.touchX = e.clientX;
    live.current.touchY = e.clientY;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) {
      d.moved = true;
      stopAnims();
      live.current.lift = 1;
    }
    const rawCx = d.originCx + dx;
    const cx =
      rawCx < OFF_CX
        ? OFF_CX + rubberband(rawCx - OFF_CX, GLASS_PHYSICS.controlRubberbandDim)
        : rawCx > ON_CX
          ? ON_CX + rubberband(rawCx - ON_CX, GLASS_PHYSICS.controlRubberbandDim)
          : rawCx;

    if (!stage.reducedMotion && baseConfig.interactive) {
      const now = performance.now();
      const dt = Math.max(8, now - d.lastTime);
      const vxPxPerMs = (e.clientX - d.lastX) / dt;
      const stretch = velocityStretch(vxPxPerMs, deform.maxVelocityStretch);
      d.lastX = e.clientX;
      d.lastTime = now;
      live.current.stretchX = 1 + stretch;
      live.current.stretchY = 1 - stretch * deform.crossAxisRatio;
    }

    live.current.cx = cx;
    live.current.fill = clamp01((cx - OFF_CX) / TRAVEL_X);
    paint();
  };

  const finishPointer = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const wasMoved = d.moved;
    d.active = false;
    d.moved = false;
    setPressed(false);
    animateTouchGlow(0);

    if (wasMoved) {
      draggedReleaseRef.current = true;
      suppressNextClickRef.current = true;
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = window.setTimeout(() => {
        suppressNextClickRef.current = false;
        suppressTimerRef.current = null;
      }, 0);
      const nextChecked = live.current.cx >= (OFF_CX + ON_CX) / 2;
      if (nextChecked !== checked) {
        onCheckedChange(nextChecked);
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      lastSourceRef.current = "keyboard";
    }
  };

  const onClick = () => {
    if (disabled) return;
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onCheckedChange(!checked);
  };

  return (
    <button
      ref={wrapRef}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className ? `lgw-switch ${className}` : "lgw-switch"}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {!hasStageSvg && (
        <svg ref={localSvgRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />
      )}
      <span className="lgw-switch__track" aria-hidden="true">
        <span ref={trackFillRef} className="lgw-switch__track-fill" />
        <span className="lgw-switch__markers">
          <span className="lgw-switch__marker-on" />
          <span className="lgw-switch__marker-off" />
        </span>
      </span>

      <span ref={thumbRef} className="lgw-switch__thumb" aria-hidden="true" />

      <div ref={loupeRef} className="lgw-glass-surface lgw-switch__loupe" aria-hidden="true">
        {useContentPath && (
          <div className="lgw-switch__content-clip" aria-hidden="true">
            <div ref={ghostTrackRef} className="lgw-switch__ghost-track" aria-hidden="true">
              <span ref={ghostFillRef} className="lgw-switch__track-fill" />
              <span className="lgw-switch__markers">
                <span className="lgw-switch__marker-on" />
                <span className="lgw-switch__marker-off" />
              </span>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
