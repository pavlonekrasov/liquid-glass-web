export interface SdfSample {
  /** Signed distance to the boundary (CSS px): < 0 inside, > 0 outside. */
  readonly distance: number;
  /** Outward unit normal X component of the nearest boundary point. */
  readonly nx: number;
  /** Outward unit normal Y component of the nearest boundary point. */
  readonly ny: number;
}

/**
 * Sample the SDF of a rounded rectangle centered on the origin.
 * @param px, py       Point relative to the rectangle's center (CSS px).
 * @param halfW, halfH Half extents (CSS px).
 * @param radius       Corner radius (CSS px), clamped to the shorter half extent.
 */
export function roundedRectSdf(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  radius: number,
): SdfSample {
  const r = Math.min(radius, halfW, halfH);
  const qx = Math.abs(px) - (halfW - r);
  const qy = Math.abs(py) - (halfH - r);
  const sx = px < 0 ? -1 : 1;
  const sy = py < 0 ? -1 : 1;
  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy);
    return { distance: len - r, nx: (sx * qx) / len, ny: (sy * qy) / len };
  }
  if (qx > qy) return { distance: qx - r, nx: sx, ny: 0 };
  return { distance: qy - r, nx: 0, ny: sy };
}
