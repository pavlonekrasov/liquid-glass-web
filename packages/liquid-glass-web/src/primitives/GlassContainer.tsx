"use client";

import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { GLASS_PHYSICS } from "../core/motion.ts";
import { GlassContainerContext, useGlassStage } from "./context.tsx";

export interface GlassContainerProps {
  /** Logical identifier for this liquid glass morphing group (e.g. "nav"). */
  id?: string;
  /** Smooth-min liquid meniscus fusion radius in CSS px (default 22). */
  mergeRadius?: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Equivalent to SwiftUI's `GlassEffectContainer`: sibling Liquid Glass elements
 * inside the same container share a smooth-min (`smin`) liquid meniscus field in
 * Tier 0 WebGL2 and stay synchronized in adaptive polarity across all 4 tiers.
 */
export function GlassContainer({
  id,
  mergeRadius = GLASS_PHYSICS.sminMergeRadiusPx,
  children,
  className,
  style,
}: GlassContainerProps) {
  const autoId = useId();
  const resolvedId = id ?? autoId;
  const { registerMorphGroup } = useGlassStage();

  const morphGroup = useMemo(
    () => (mergeRadius > 0 ? registerMorphGroup(resolvedId) : 0),
    [mergeRadius, registerMorphGroup, resolvedId],
  );

  const ctx = useMemo(
    () => ({ id: resolvedId, morphGroup, mergeRadius: Math.max(0, mergeRadius) }),
    [resolvedId, morphGroup, mergeRadius],
  );

  return (
    <GlassContainerContext.Provider value={ctx}>
      <div
        className={className ? `lgw-container ${className}` : "lgw-container"}
        data-lgw-container={resolvedId}
        style={style}
      >
        {children}
      </div>
    </GlassContainerContext.Provider>
  );
}
