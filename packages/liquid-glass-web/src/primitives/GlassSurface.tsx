"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { animate, type AnimationPlaybackControls } from "motion/react";
import { GLASS_SPRINGS, glassDeformationForSize } from "../core/motion.ts";
import { resolveGlassConfig, type GlassMaterialProps } from "../core/presets.ts";
import { useLiquidGlass, type LiquidGlassDiagnostics } from "../engines/useLiquidGlass.ts";
import { useGlassContainer, useGlassStage } from "./context.tsx";

export interface GlassSurfaceProps
  extends GlassMaterialProps,
    Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  /** Applies the stage's legibility scrim to this surface (default true). */
  applyScrim?: boolean;
  /** Corner radius in CSS px or CSS length (default "999px" capsule). */
  radius?: number | string;
  onDiagnostics?: (diag: LiquidGlassDiagnostics | null) => void;
}

/** Glass surface primitive. Works on every tier and merges inside GlassContainer. */
export function GlassSurface({
  children,
  variant,
  shapeProfile,
  refraction,
  dispersion,
  frost,
  interactive,
  adaptiveContrast,
  engine,
  optics,
  applyScrim = true,
  radius,
  onDiagnostics,
  className,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  ...rest
}: GlassSurfaceProps) {
  const stage = useGlassStage();
  const container = useGlassContainer();
  const surfaceId = useId();
  const elRef = useRef<HTMLDivElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);

  const { hasStageSvg } = stage;
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

  const { diag } = useLiquidGlass(elRef, svgRef, config, {
    role: "surface",
    enabled: !useHic,
    frostOnly,
  });

  useEffect(() => {
    onDiagnostics?.(diag);
  }, [diag, onDiagnostics]);

  const touchRef = useRef({ x: 0, y: 0, glow: 0, pressed: false });
  const glowAnimRef = useRef<AnimationPlaybackControls | null>(null);

  const pushHic = useCallback(() => {
    const bridge = stage.hicBridge;
    const el = elRef.current;
    if (!bridge || !el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;
    const cs = getComputedStyle(el);
    const parsedR = Number.parseFloat(cs.borderTopLeftRadius) || Math.min(r.width, r.height) / 2;
    const effR = Math.min(parsedR, r.width / 2, r.height / 2);
    const deform = glassDeformationForSize(r.width, r.height, config.pressCompression);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    bridge.upsertSurface(`surface-${surfaceId}`, {
      kind: "glass",
      morphGroup: container.morphGroup,
      mergeK: container.mergeRadius,
      applyScrim,
      cx,
      cy,
      w: r.width,
      h: r.height,
      radius: effR,
      touchX: touchRef.current.x || cx,
      touchY: touchRef.current.y || cy,
      touchGlow: config.interactive ? touchRef.current.glow : 0,
      touchRadius: deform.touchGlowRadius,
    });
  }, [
    applyScrim,
    config.interactive,
    config.pressCompression,
    container.mergeRadius,
    container.morphGroup,
    stage.hicBridge,
    surfaceId,
  ]);

  const { registerUnionElement, notifyUnionMove } = container;

  useEffect(() => {
    if (useHic || frostOnly || container.mergeRadius <= 0) return;
    const key = `surface-${surfaceId}`;
    registerUnionElement(key, elRef.current);
    const raf = requestAnimationFrame(() => notifyUnionMove());
    return () => {
      cancelAnimationFrame(raf);
      registerUnionElement(key, null);
    };
  }, [useHic, frostOnly, container.mergeRadius, surfaceId, registerUnionElement, notifyUnionMove]);

  useEffect(() => {
    const bridge = stage.hicBridge;
    if (!bridge) return;
    const el = elRef.current;
    const ro = el ? new ResizeObserver(pushHic) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", pushHic);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", pushHic);
      bridge.removeSurface(`surface-${surfaceId}`);
    };
  }, [stage.hicBridge, pushHic, surfaceId]);

  useEffect(() => {
    if (!stage.hicBridge) return;
    pushHic();
    const raf = requestAnimationFrame(pushHic);
    return () => cancelAnimationFrame(raf);
  }, [stage.hicBridge, stage.layoutVersion, pushHic]);

  const animateGlow = useCallback(
    (target: number) => {
      if (!config.interactive) return;
      glowAnimRef.current?.stop();
      if (stage.reducedMotion) {
        touchRef.current.glow = target > 0.5 ? 0.5 : 0;
        pushHic();
        return;
      }
      glowAnimRef.current = animate(touchRef.current.glow, target, {
        ...GLASS_SPRINGS.micro,
        onUpdate: (v) => {
          touchRef.current.glow = v;
          pushHic();
        },
      });
    },
    [config.interactive, pushHic, stage.reducedMotion],
  );

  useEffect(() => () => glowAnimRef.current?.stop(), []);

  const scrimStyle: CSSProperties =
    applyScrim && config.adaptiveContrast && stage.legibility
      ? {
          backgroundColor: `rgb(${stage.legibility.scrimRgb[0]} ${stage.legibility.scrimRgb[1]} ${stage.legibility.scrimRgb[2]})`,
          opacity: stage.legibility.scrimAlpha > 0.005 ? stage.legibility.scrimAlpha : 0,
        }
      : { opacity: 0 };

  const mergedStyle: CSSProperties = {
    ...(radius !== undefined
      ? { borderRadius: typeof radius === "number" ? `${radius}px` : radius }
      : {}),
    ...style,
  };

  return (
    <div
      ref={elRef}
      className={className ? `lgw-glass-surface ${className}` : "lgw-glass-surface"}
      style={mergedStyle}
      onPointerDown={(e) => {
        touchRef.current.pressed = true;
        touchRef.current.x = e.clientX;
        touchRef.current.y = e.clientY;
        animateGlow(1);
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        if (touchRef.current.pressed) {
          touchRef.current.x = e.clientX;
          touchRef.current.y = e.clientY;
          pushHic();
        }
        onPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        touchRef.current.pressed = false;
        animateGlow(0);
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        touchRef.current.pressed = false;
        animateGlow(0);
        onPointerLeave?.(e);
      }}
      onPointerCancel={(e) => {
        touchRef.current.pressed = false;
        animateGlow(0);
        onPointerCancel?.(e);
      }}
      {...rest}
    >
      {!hasStageSvg && (
        <svg ref={localSvgRef} className="lgw-svg-host" aria-hidden="true" focusable="false" />
      )}
      {applyScrim && <span className="lgw-scrim" style={scrimStyle} aria-hidden="true" />}
      {children}
    </div>
  );
}
