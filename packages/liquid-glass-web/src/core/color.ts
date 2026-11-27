import { resolveCssColor } from "./cssColor.ts";

export type SRGB = readonly [number, number, number];
export type RgbColor = { readonly r: number; readonly g: number; readonly b: number };
export type OKLCH = readonly [lightness: number, chroma: number, hue: number];

/** Encoded sRGB byte-scale channel [0..255] -> linear light without range clipping. */
export function srgb255ToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Clamped sRGB byte-scale channel [0..255] -> linear light [0..1]. */
export function clampedSrgb255ToLinear(channel: number): number {
  return srgb255ToLinear(Math.min(255, Math.max(0, channel)));
}

/** Linear light -> encoded, clipped sRGB byte-scale channel [0..255]. */
export function linearToSrgb255(linear: number): number {
  const value =
    linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, value)) * 255;
}

/** WCAG 2.1 relative luminance from encoded sRGB bytes [0..255]. */
export function relativeLuminance([r, g, b]: SRGB): number {
  return (
    0.2126 * clampedSrgb255ToLinear(r) +
    0.7152 * clampedSrgb255ToLinear(g) +
    0.0722 * clampedSrgb255ToLinear(b)
  );
}

/** WCAG 2.1 contrast ratio for two relative-luminance values. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Encoded sRGB [0..255] -> OKLCH perceptual coordinates. */
export function srgbToOklch([r, g, b]: SRGB): OKLCH {
  const red = clampedSrgb255ToLinear(r);
  const green = clampedSrgb255ToLinear(g);
  const blue = clampedSrgb255ToLinear(b);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360;
  return [lightness, Math.hypot(a, bAxis), hue];
}

/**
 * Parse a CSS color (hex with or without "#", or any CSS color syntax) into sRGB
 * bytes [0..255], dropping alpha. Use parseCssColor to keep alpha.
 */
export function hexToRgb(hex: string, fallback: RgbColor = { r: 14, g: 18, b: 28 }): RgbColor {
  const clean = hex.trim();
  const parsed = resolveCssColor(/^[0-9a-f]{3,8}$/i.test(clean) ? `#${clean}` : clean);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : fallback;
}

/** Format an sRGB color into lowercase #rrggbb hex. */
export function rgbToHex({ r, g, b }: RgbColor): string {
  const byte = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}
