/* ===========================================================================
   Live Backdrop Luminance Sampler for Scroll-Adaptive WCAG AA Legibility.
   Separates 10-point area-weighted `polaritySamples` from worst-case
   `contrastSamples` while skipping glass chrome and Tier 0 HIC canvases.
   =========================================================================== */

import type { SRGB } from "../core/color.ts";
import { clamp01 } from "../core/motion.ts";

let sampleCanvas: HTMLCanvasElement | null = null;
let sampleCtx: CanvasRenderingContext2D | null = null;

function parseCssRgba(css: string): [number, number, number, number] {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/.exec(css);
  if (!m) return [0, 0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
}

function parseDataSamples(attr: string): SRGB[] {
  const out: SRGB[] = [];
  for (const part of attr.split(";")) {
    const nums = part.split(",").map((s) => Number(s.trim()));
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      out.push([nums[0], nums[1], nums[2]]);
    }
  }
  return out;
}

function readSampleAttr(el: Element): string | null {
  return el.getAttribute("data-lgw-bg-samples") ?? el.getAttribute("data-lab-bg-samples");
}

function sampleCanvasPixel(c: HTMLCanvasElement, cr: DOMRect, x: number, y: number): SRGB | null {
  if (cr.width <= 0 || cr.height <= 0 || c.width <= 0 || c.height <= 0) return null;
  sampleCanvas ??= document.createElement("canvas");
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  sampleCtx ??= sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return null;
  const u = clamp01((x - cr.left) / cr.width);
  const v = clamp01((y - cr.top) / cr.height);
  try {
    sampleCtx.clearRect(0, 0, 1, 1);
    sampleCtx.drawImage(
      c,
      Math.min(c.width - 1, u * c.width),
      Math.min(c.height - 1, v * c.height),
      1,
      1,
      0,
      0,
      1,
      1,
    );
    const d = sampleCtx.getImageData(0, 0, 1, 1).data;
    if (d[3] > 20) return [d[0], d[1], d[2]];
  } catch {
    // ignore tainted cross-origin canvases
  }
  return null;
}

/**
 * Samples live pixels behind a glass surface footprint:
 * - `polaritySamples`: 10 area-weighted point colors driving calm Schmitt-trigger polarity.
 * - `contrastSamples`: includes all gradient stops of overlapped cards for worst-case AA scrim.
 */
export function sampleBackdropBehind(
  surfaceEl: HTMLElement,
  excludeRoot?: HTMLElement | null,
): { polaritySamples: SRGB[]; contrastSamples: SRGB[] } {
  const rect = surfaceEl.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) {
    return { polaritySamples: [], contrastSamples: [] };
  }

  const isExcluded = (el: Element) => {
    if (excludeRoot && excludeRoot.contains(el)) return true;
    if (surfaceEl.contains(el)) return true;
    if (el.classList.contains("lgw-hic-canvas") || el.classList.contains("lgw-hic-chrome")) {
      return true;
    }
    if (el.closest(".lgw-chrome, .lgw-hic-chrome")) return true;
    return false;
  };

  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas")).filter(
    (c) => !isExcluded(c) && c.width > 0 && c.height > 0,
  );
  const canvasRects = canvases.map((c) => ({ el: c, rect: c.getBoundingClientRect() }));

  const scrollContainer = document.querySelector<HTMLElement>('[data-lgw-scroll-container="true"]');
  const sceneSampleNodes = scrollContainer
    ? Array.from(
        scrollContainer.querySelectorAll<HTMLElement>(
          "[data-lgw-bg-samples], [data-lab-bg-samples], [data-lgw-surface-bg]",
        ),
      ).map((el) => ({ el, rect: el.getBoundingClientRect() }))
    : [];

  const polaritySamples: SRGB[] = [];
  const contrastSamples: SRGB[] = [];
  const seenSampleAttr = new Set<Element>();
  const rows = [0.28, 0.72];
  const cols = 5;

  const pushAttr = (el: Element, attr: string): boolean => {
    const parsed = parseDataSamples(attr);
    if (parsed.length === 0) return false;
    const avg: SRGB = [
      parsed.reduce((s, c) => s + c[0], 0) / parsed.length,
      parsed.reduce((s, c) => s + c[1], 0) / parsed.length,
      parsed.reduce((s, c) => s + c[2], 0) / parsed.length,
    ];
    polaritySamples.push(avg);
    if (!seenSampleAttr.has(el)) {
      seenSampleAttr.add(el);
      for (const rgb of parsed) contrastSamples.push(rgb);
    }
    return true;
  };

  for (const rowFrac of rows) {
    const y = Math.min(window.innerHeight - 2, Math.max(2, rect.top + rect.height * rowFrac));
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const x = Math.min(
        window.innerWidth - 2,
        Math.max(2, rect.left + ((cIdx + 0.5) / cols) * rect.width),
      );
      const stack = document.elementsFromPoint(x, y);
      let found = false;

      for (const el of stack) {
        if (isExcluded(el)) continue;
        const sampleAttr = readSampleAttr(el);
        if (sampleAttr && pushAttr(el, sampleAttr)) {
          found = true;
          break;
        }
        if (el.tagName === "CANVAS") {
          const c = el as HTMLCanvasElement;
          const px = sampleCanvasPixel(c, c.getBoundingClientRect(), x, y);
          if (px) {
            polaritySamples.push(px);
            contrastSamples.push(px);
            found = true;
            break;
          }
        }
        const [r, g, b, a] = parseCssRgba(getComputedStyle(el).backgroundColor);
        if (a >= 0.9) {
          const px: SRGB = [r, g, b];
          polaritySamples.push(px);
          contrastSamples.push(px);
          found = true;
          break;
        }
      }

      if (!found && sceneSampleNodes.length > 0) {
        for (let idx = sceneSampleNodes.length - 1; idx >= 0; idx--) {
          const { el, rect: sr } = sceneSampleNodes[idx];
          if (x < sr.left || x > sr.right || y < sr.top || y > sr.bottom) continue;
          const sampleAttr = readSampleAttr(el);
          if (sampleAttr && pushAttr(el, sampleAttr)) {
            found = true;
            break;
          }
          const [r, g, b, a] = parseCssRgba(getComputedStyle(el).backgroundColor);
          if (a >= 0.9) {
            const px: SRGB = [r, g, b];
            polaritySamples.push(px);
            contrastSamples.push(px);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        for (const { el: c, rect: cr } of canvasRects) {
          if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) continue;
          const px = sampleCanvasPixel(c, cr, x, y);
          if (px) {
            polaritySamples.push(px);
            contrastSamples.push(px);
            found = true;
            break;
          }
        }
      }

      if (!found && scrollContainer) {
        const [r, g, b, a] = parseCssRgba(getComputedStyle(scrollContainer).backgroundColor);
        if (a >= 0.9) {
          const px: SRGB = [r, g, b];
          polaritySamples.push(px);
          contrastSamples.push(px);
        }
      }
    }
  }

  return { polaritySamples, contrastSamples };
}
