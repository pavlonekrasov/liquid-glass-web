"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { animate, type AnimationPlaybackControls } from "motion/react";
import { GLASS_SPRINGS, glassDeformationForSize } from "../core/motion.ts";
import { resolveGlassConfig, type GlassMaterialProps } from "../core/presets.ts";
import { useLiquidGlass } from "../engines/useLiquidGlass.ts";
import { useGlassContainer, useGlassStage } from "../primitives/context.tsx";

export type GlassOrbSize = "sm" | "md" | "lg";

export interface GlassOrbProps
  extends GlassMaterialProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children?: ReactNode;
  /** Pulls the orb into sibling GlassTabBar/GlassSurface for smin liquid meniscus fusion. */
  merged?: boolean;
  /** Horizontal offset (px) when merged in Tier 0 WebGL2 (default -11 closes 14px gap to 3px). */
  mergeOffsetPx?: number;
  /** Diameter preset: sm (52px), md (56px), lg (60px, default matching compact TabBar). */
  size?: GlassOrbSize;
}

const ORB_SIZES: Record<GlassOrbSize, number> = { sm: 52, md: 56, lg: 60 };

/**
 * Circular Liquid Glass action button (e.g. Search / Compose orb) that fuses via
 * polynomial smooth-min (`smin`) with sibling surfaces inside `<GlassContainer>`
 * and maintains 100% adaptive tint & polarity parity over daylight and dark feeds.
 */
export function GlassOrb({
  children,
  merged = false,
  mergeOffsetPx = -11,
  size = "lg",
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  ...rest
}: GlassOrbProps) {
  const stage = useGlassStage();
  const container = useGlassContainer();
  const orbId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);
  const [pressed, setPressed] = useState(false);

  const hasStageSvg = stage.svgHostRef.current !== null;
  const svgRef = hasStageSvg ? stage.svgHostRef : localSvgRef;

  const config = useMemo(
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
  const frostOnly = stage.tier === "frost" || config.engine === "frost";
  const diameter = ORB_SIZES[size];
  const deform = useMemo(
    () => glassDeformationForSize(diameter, diameter, config.pressCompression),
    [diameter, config.pressCompression],
  );

  useLiquidGlass(btnRef, svgRef, config, {
    role: "surface",
    enabled: !useHic,
    frostOnly,
  });

  const live = useRef({
    offsetX: merged ? (useHic ? mergeOffsetPx : Math.round(mergeOffsetPx * 0.55)) : 0,
    scale: 1,
    touchX: 0,
    touchY: 0,
    touchGlow: 0,
  });
  const animsRef = useRef<AnimationPlaybackControls[]>([]);
  const glowAnimRef = useRef<AnimationPlaybackControls | null>(null);

  const paintOrb = useCallback(
    (syncChrome = false) => {
      const btn = btnRef.current;
      const { offsetX, scale, touchX, touchY, touchGlow } = live.current;
      if (btn) {
        btn.style.transform = `translate3d(${offsetX.toFixed(2)}px, 0, 0) scale(${scale.toFixed(4)})`;
      }
      if (!stage.hicBridge || !btn) return;
      const r = btn.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4) {
        stage.hicBridge.removeSurface(`orb-${orbId}`);
        return;
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      stage.hicBridge.upsertSurface(`orb-${orbId}`, {
        kind: "glass",
        morphGroup: container.morphGroup,
        mergeK: container.mergeRadius,
        applyScrim: false,
        cx,
        cy,
        w: r.width,
        h: r.height,
        radius: Math.min(r.width, r.height) / 2,
        touchX: touchX || cx,
        touchY: touchY || cy,
        touchGlow: config.interactive ? touchGlow : 0,
        touchRadius: deform.touchGlowRadius,
      });
      if (syncChrome) stage.hicBridge.requestPaint();
    },
    [
      config.interactive,
      container.mergeRadius,
      container.morphGroup,
      deform.touchGlowRadius,
      orbId,
      stage.hicBridge,
    ],
  );

  const animateGlow = useCallback(
    (target: number) => {
      if (!config.interactive) return;
      glowAnimRef.current?.stop();
      if (stage.reducedMotion) {
        live.current.touchGlow = target > 0.5 ? 0.6 : 0;
        paintOrb(false);
        return;
      }
      glowAnimRef.current = animate(live.current.touchGlow, target, {
        ...GLASS_SPRINGS.micro,
        onUpdate: (v) => {
          live.current.touchGlow = v;
          paintOrb(false);
        },
      });
    },
    [config.interactive, paintOrb, stage.reducedMotion],
  );

  useEffect(() => {
    for (const c of animsRef.current) c.stop();
    animsRef.current = [];

    const targetOffset = merged ? (useHic ? mergeOffsetPx : Math.round(mergeOffsetPx * 0.55)) : 0;
    const targetScale = pressed && config.interactive ? deform.pressScale : 1;

    if (stage.reducedMotion) {
      live.current.offsetX = targetOffset;
      live.current.scale = targetScale;
      paintOrb(true);
      return;
    }

    animsRef.current = [
      animate(live.current.offsetX, targetOffset, {
        ...GLASS_SPRINGS.morph,
        onUpdate: (v) => {
          live.current.offsetX = v;
          paintOrb(true);
        },
      }),
      animate(live.current.scale, targetScale, {
        ...GLASS_SPRINGS.micro,
        onUpdate: (v) => {
          live.current.scale = v;
          paintOrb(true);
        },
      }),
    ];
  }, [
    merged,
    mergeOffsetPx,
    pressed,
    config.interactive,
    deform.pressScale,
    stage.reducedMotion,
    useHic,
    paintOrb,
  ]);

  useEffect(() => {
    if (!stage.hicBridge) return;
    paintOrb(false);
    const raf = requestAnimationFrame(() => paintOrb(false));
    const onResize = () => paintOrb(false);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      stage.hicBridge?.removeSurface(`orb-${orbId}`);
    };
  }, [stage.hicBridge, stage.layoutVersion, orbId, paintOrb]);

  useEffect(
    () => () => {
      for (const c of animsRef.current) c.stop();
      glowAnimRef.current?.stop();
    },
    [],
  );

  const scrimStyle: CSSProperties =
    config.adaptiveContrast && stage.legibility
      ? {
          backgroundColor: `rgb(${stage.legibility.scrimRgb[0]} ${stage.legibility.scrimRgb[1]} ${stage.legibility.scrimRgb[2]})`,
          opacity: stage.legibility.scrimAlpha > 0.005 ? stage.legibility.scrimAlpha : 0,
        }
      : { opacity: 0 };

  return (
    <button
      ref={btnRef}
      type="button"
      className={`lgw-glass-surface lgw-orb lgw-orb--${size}${className ? ` ${className}` : ""}`}
      style={style}
      aria-pressed={rest["aria-pressed"] ?? merged}
      onPointerDown={(e) => {
        live.current.touchX = e.clientX;
        live.current.touchY = e.clientY;
        setPressed(true);
        animateGlow(1);
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        if (pressed) {
          live.current.touchX = e.clientX;
          live.current.touchY = e.clientY;
          paintOrb(false);
        }
        onPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        setPressed(false);
        animateGlow(0);
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        setPressed(false);
        animateGlow(0);
        onPointerLeave?.(e);
      }}
      onPointerCancel={(e) => {
        setPressed(false);
        animateGlow(0);
        onPointerCancel?.(e);
      }}
      {...rest}
    >
      {!hasStageSvg && (
        <svg ref={localSvgRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />
      )}
      <span className="lgw-scrim" style={scrimStyle} aria-hidden="true" />
      {children}
    </button>
  );
}
