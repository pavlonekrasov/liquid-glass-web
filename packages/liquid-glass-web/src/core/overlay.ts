/* ===========================================================================
   Seam-Free Liquid Glass Overlays — paints Beer–Lambert tint (::before) and
   dual-bounce Fresnel rim lighting (::after) with zero hairlines at any DPR
   (1x, 1.25x, 1.5x, 1.75x, 2x, 3x). Pure math + SVG string generation, no DOM.

   Every piece is opaque and painted in an order where each piece's inner edge
   lands on a value equal to its own:
     1. face over the whole box;
     2. full-width top and bottom bands;
     3. full-height side bands ending >= SEAM_MARGIN inside the corners;
     4. four corners continuing the bands they meet.
   Alpha fields are encoded as grey luminance masks (CSS mask-image on WebKit /
   Firefox, SVG <mask> via -webkit-mask-box-image on Chromium).
   =========================================================================== */

import type { RgbColor } from "./color.ts";

export type Corner = "tl" | "tr" | "bl" | "br";
export type Side = "top" | "right" | "bottom" | "left";
export type Piece = Side | Corner;

export interface Tile {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Alpha field on a nine-slice grid: bytes 0..255 with AA coverage included. */
export interface AlphaSheet {
  readonly size: number;
  readonly slice: number;
  readonly radius: number;
  readonly dpr: number;
  readonly alpha: Uint8ClampedArray;
}

/** Straight sRGB color field on a nine-slice grid (r, g, b per pixel). */
export interface ColorSheet {
  readonly size: number;
  readonly slice: number;
  readonly radius: number;
  readonly dpr: number;
  readonly rgb: Uint8ClampedArray;
}

/** Paint order (after face): bands first, corners last. */
export const PIECE_ORDER: readonly Piece[] = [
  "top",
  "bottom",
  "left",
  "right",
  "tl",
  "tr",
  "bl",
  "br",
];

/** CSS px between a side band's inner edge and the corners' inner edge (>= 1 device px at DPR >= 1). */
export const SEAM_MARGIN = 1;

export interface OverlayPieces {
  readonly radius: number;
  readonly band: number;
  readonly face: RgbColor;
  readonly cut: number;
  readonly inset: number;
  readonly pad: number;
  readonly tiles: Record<Piece, Tile | null>;
}

type Pads = { top?: number; right?: number; bottom?: number; left?: number };

function reader(sheet: AlphaSheet | ColorSheet): (x: number, y: number) => RgbColor {
  if ("alpha" in sheet) {
    return (x, y) => {
      const v = sheet.alpha[y * sheet.size + x];
      return { r: v, g: v, b: v };
    };
  }
  return (x, y) => {
    const k = (y * sheet.size + x) * 3;
    return { r: sheet.rgb[k], g: sheet.rgb[k + 1], b: sheet.rgb[k + 2] };
  };
}

function copier(
  sheet: AlphaSheet | ColorSheet,
): (x: number, y: number, data: Uint8ClampedArray, k: number) => void {
  if ("alpha" in sheet) {
    return (x, y, data, k) => {
      const v = sheet.alpha[y * sheet.size + x];
      data[k] = v;
      data[k + 1] = v;
      data[k + 2] = v;
    };
  }
  return (x, y, data, k) => {
    const s = (y * sheet.size + x) * 3;
    data[k] = sheet.rgb[s];
    data[k + 1] = sheet.rgb[s + 1];
    data[k + 2] = sheet.rgb[s + 2];
  };
}

function opaqueTile(
  copy: ReturnType<typeof copier>,
  x0: number,
  y0: number,
  width: number,
  height: number,
  pads: Pads,
  clamp: boolean,
): Tile {
  const { top = 0, right = 0, bottom = 0, left = 0 } = pads;
  const w = left + width + right;
  const h = top + height + bottom;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const fi = i - left;
      const fj = j - top;
      const k = (j * w + i) * 4;
      if (clamp || (fi >= 0 && fi < width && fj >= 0 && fj < height)) {
        copy(
          x0 + Math.min(width - 1, Math.max(0, fi)),
          y0 + Math.min(height - 1, Math.max(0, fj)),
          data,
          k,
        );
      }
      data[k + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * Cut a nine-slice sheet into seam-free opaque SVG pieces.
 * `inset` is the CSS px between the border box and the field (usually host border width).
 */
export function overlayPieces(
  sheet: AlphaSheet | ColorSheet,
  margin = SEAM_MARGIN,
  inset = 0,
): OverlayPieces {
  const { size, slice: rp, radius } = sheet;
  const cssPerPx = radius / rp;
  const at = reader(sheet);
  const clamp = !("alpha" in sheet);
  const step = (a: RgbColor, b: RgbColor) =>
    Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

  const nv = Math.max(0, Math.min(rp, Math.floor((radius - margin) / cssPerPx + 1e-9)));
  const face = at(rp, rp);
  let cut = 0;
  for (let i = nv; i < rp; i++) {
    cut = Math.max(cut, step(at(i, rp), face), step(at(size - 1 - i, rp), face));
  }

  const k = Math.ceil(inset / cssPerPx - 1e-9) + 1;
  const copy = copier(sheet);
  const tile = (x0: number, y0: number, w: number, h: number, pads: Pads) =>
    opaqueTile(copy, x0, y0, w, h, pads, clamp);

  return {
    radius,
    band: nv * cssPerPx,
    face,
    cut,
    inset,
    pad: k * cssPerPx,
    tiles: {
      top: tile(rp, 0, 1, rp, { top: k }),
      bottom: tile(rp, rp + 1, 1, rp, { bottom: k }),
      left: nv > 0 ? tile(0, rp, nv, 1, { left: k }) : null,
      right: nv > 0 ? tile(size - nv, rp, nv, 1, { right: k }) : null,
      tl: tile(0, 0, rp, rp, { top: k, left: k }),
      tr: tile(rp + 1, 0, rp, rp, { top: k, right: k }),
      bl: tile(0, rp + 1, rp, rp, { bottom: k, left: k }),
      br: tile(rp + 1, rp + 1, rp, rp, { bottom: k, right: k }),
    },
  };
}

const num = (n: number) => String(+n.toFixed(4));
const BEYOND = `x="-50%" y="-50%" width="200%" height="200%"`;

type Placed = Pick<OverlayPieces, "radius" | "band" | "inset" | "pad">;

function placement(piece: Piece, { radius, band, inset, pad }: Placed): string {
  const size = num(radius + pad);
  const side = num(band + pad);
  const out = num(inset - pad);
  const back = num(radius + inset);
  const backSide = num(band + inset);
  switch (piece) {
    case "top":
      return `x="-50%" y="${out}" width="200%" height="${size}"`;
    case "bottom":
      return `x="-50%" y="100%" width="200%" height="${size}" transform="translate(0 -${back})"`;
    case "left":
      return `x="${out}" y="-50%" width="${side}" height="200%"`;
    case "right":
      return `x="100%" y="-50%" width="${side}" height="200%" transform="translate(-${backSide} 0)"`;
    case "tl":
      return `x="${out}" y="${out}" width="${size}" height="${size}"`;
    case "tr":
      return `x="100%" y="${out}" width="${size}" height="${size}" transform="translate(-${back} 0)"`;
    case "bl":
      return `x="${out}" y="100%" width="${size}" height="${size}" transform="translate(0 -${back})"`;
    case "br":
      return `x="100%" y="100%" width="${size}" height="${size}" transform="translate(-${back} -${back})"`;
  }
}

/**
 * Generates seam-free SVG markup placing opaque PNG tiles in PIECE_ORDER.
 * When `asAlpha` is true (Chromium -webkit-mask-box-image), wraps the grey
 * luminance field inside an SVG <mask> over black so the image carries alpha.
 */
export function fieldSvg(
  pieces: Placed & Pick<OverlayPieces, "face">,
  urls: Partial<Record<Piece, string>>,
  asAlpha = false,
): string {
  const { r, g, b } = pieces.face;
  const images = PIECE_ORDER.filter(
    (p) => urls[p] && (pieces.band > 0 || (p !== "left" && p !== "right")),
  )
    .map((p) => `<image preserveAspectRatio="none" ${placement(p, pieces)} href="${urls[p]}"/>`)
    .join("");
  const field = `<rect ${BEYOND} fill="rgb(${r},${g},${b})"/>${images}`;
  const body = asAlpha
    ? `<mask id="f" maskUnits="userSpaceOnUse" ${BEYOND}>${field}</mask><rect ${BEYOND} mask="url(#f)"/>`
    : field;
  return `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Encodes SVG markup as a CSS url("...") data URI. */
export function fieldDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
