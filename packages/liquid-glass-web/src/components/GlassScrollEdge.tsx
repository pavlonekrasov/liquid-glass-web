"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { clamp01 } from "../core/motion.ts";

export interface GlassScrollEdgeProps {
  /** Edge the effect sits on (default "bottom"). */
  readonly position?: "bottom" | "top";
  /** Band height in CSS pixels (default 112). */
  readonly height?: number;
  /** CSS color of the tonal fade behind the blur bands. */
  readonly tintColor?: string;
  /** Keep the effect visible when scrolled all the way to the edge (default false). */
  readonly alwaysVisible?: boolean;
  /** Distance in px over which the effect fades near the scroll edge (default 72). */
  readonly fadeDistance?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Progressive blur at a scroll edge that fades out as content reaches the boundary.
 * Turns off under prefers-reduced-transparency and forced-colors.
 */
export function GlassScrollEdge({
  position = "bottom",
  height = 112,
  tintColor = "var(--paper, #faf8f4)",
  alwaysVisible = false,
  fadeDistance = 72,
  className,
  style,
}: GlassScrollEdgeProps) {
  const [intensity, setIntensity] = useState(alwaysVisible ? 1 : 0);

  useEffect(() => {
    if (alwaysVisible) {
      setIntensity(1);
      return;
    }

    let raf = 0;
    const measure = () => {
      raf = 0;
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const remaining =
        position === "bottom"
          ? Math.max(0, doc.scrollHeight - window.innerHeight - scrollTop)
          : Math.max(0, scrollTop);
      const next = remaining <= 4 ? 0 : clamp01((remaining - 4) / Math.max(16, fadeDistance));
      setIntensity((prev) => (Math.abs(prev - next) < 0.015 ? prev : next));
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [alwaysVisible, fadeDistance, position]);

  const edgeStyle = {
    height: `${height}px`,
    "--lgw-edge-tint": tintColor,
    "--lgw-edge-opacity": intensity.toFixed(3),
    ...style,
  } as CSSProperties;

  return (
    <div
      className={`lgw-scroll-edge lgw-scroll-edge--${position}${className ? ` ${className}` : ""}`}
      style={edgeStyle}
      data-lgw-scroll-edge={position}
      aria-hidden="true"
    >
      <span className="lgw-scroll-edge__band lgw-scroll-edge__band--far" />
      <span className="lgw-scroll-edge__band lgw-scroll-edge__band--mid" />
      <span className="lgw-scroll-edge__band lgw-scroll-edge__band--near" />
      <span className="lgw-scroll-edge__tint" />
    </div>
  );
}
