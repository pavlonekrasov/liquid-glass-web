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

export type GlassButtonSize = "sm" | "md" | "lg";

export interface GlassButtonProps
  extends GlassMaterialProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children?: ReactNode;
  size?: GlassButtonSize;
}

/** Capsule button with a 44px minimum touch target and press feedback. */
export function GlassButton({
  children,
  size = "md",
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
}: GlassButtonProps) {
  const stage = useGlassStage();
  const container = useGlassContainer();
  const btnId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const localSvgRef = useRef<SVGSVGElement>(null);
  const [pressed, setPressed] = useState(false);

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

  useLiquidGlass(btnRef, svgRef, config, {
    role: "surface",
    enabled: !useHic,
    frostOnly,
  });

  const live = useRef({ scale: 1, touchX: 0, touchY: 0, touchGlow: 0 });
  const scaleAnimRef = useRef<AnimationPlaybackControls | null>(null);
  const glowAnimRef = useRef<AnimationPlaybackControls | null>(null);

  const paintBtn = useCallback(
    (syncChrome = false) => {
      const btn = btnRef.current;
      if (btn) {
        btn.style.transform = `scale(${live.current.scale.toFixed(4)})`;
      }
      if (!stage.hicBridge || !btn) return;
      const r = btn.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4) {
        stage.hicBridge.removeSurface(`btn-${btnId}`);
        return;
      }
      const deform = glassDeformationForSize(r.width, r.height, config.pressCompression);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      stage.hicBridge.upsertSurface(`btn-${btnId}`, {
        kind: "glass",
        morphGroup: container.morphGroup,
        mergeK: container.mergeRadius,
        applyScrim: true,
        cx,
        cy,
        w: r.width,
        h: r.height,
        radius: Math.min(r.width, r.height) / 2,
        touchX: live.current.touchX || cx,
        touchY: live.current.touchY || cy,
        touchGlow: config.interactive ? live.current.touchGlow : 0,
        touchRadius: deform.touchGlowRadius,
      });
      if (syncChrome) stage.hicBridge.requestPaint();
    },
    [
      btnId,
      config.interactive,
      config.pressCompression,
      container.mergeRadius,
      container.morphGroup,
      stage.hicBridge,
    ],
  );

  const animateGlow = useCallback(
    (target: number) => {
      if (!config.interactive) return;
      glowAnimRef.current?.stop();
      if (stage.reducedMotion) {
        live.current.touchGlow = target > 0.5 ? 0.55 : 0;
        paintBtn(false);
        return;
      }
      glowAnimRef.current = animate(live.current.touchGlow, target, {
        ...GLASS_SPRINGS.micro,
        onUpdate: (v) => {
          live.current.touchGlow = v;
          paintBtn(false);
        },
      });
    },
    [config.interactive, paintBtn, stage.reducedMotion],
  );

  useEffect(() => {
    scaleAnimRef.current?.stop();
    const btn = btnRef.current;
    const deform = glassDeformationForSize(
      btn?.offsetWidth || 120,
      btn?.offsetHeight || 46,
      config.pressCompression,
    );
    const target = pressed && config.interactive ? deform.pressScale : 1;
    if (stage.reducedMotion) {
      live.current.scale = target;
      paintBtn(true);
      return;
    }
    scaleAnimRef.current = animate(live.current.scale, target, {
      ...GLASS_SPRINGS.micro,
      onUpdate: (v) => {
        live.current.scale = v;
        paintBtn(true);
      },
    });
  }, [pressed, config.interactive, config.pressCompression, stage.reducedMotion, paintBtn]);

  const { registerUnionElement, notifyUnionMove } = container;

  useEffect(() => {
    if (useHic || frostOnly || container.mergeRadius <= 0) return;
    const key = `btn-${btnId}`;
    registerUnionElement(key, btnRef.current);
    const raf = requestAnimationFrame(() => notifyUnionMove());
    return () => {
      cancelAnimationFrame(raf);
      registerUnionElement(key, null);
    };
  }, [useHic, frostOnly, container.mergeRadius, btnId, registerUnionElement, notifyUnionMove]);

  useEffect(() => {
    if (!stage.hicBridge) return;
    paintBtn(false);
    const raf = requestAnimationFrame(() => paintBtn(false));
    const onResize = () => paintBtn(false);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      stage.hicBridge?.removeSurface(`btn-${btnId}`);
    };
  }, [stage.hicBridge, stage.layoutVersion, btnId, paintBtn]);

  useEffect(
    () => () => {
      scaleAnimRef.current?.stop();
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
      type={rest.type ?? "button"}
      className={`lgw-glass-surface lgw-button lgw-button--${size}${className ? ` ${className}` : ""}`}
      style={style}
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
          paintBtn(false);
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
