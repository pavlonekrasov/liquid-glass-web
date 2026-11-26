"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  FRAG_HIC_BAR,
  FRAG_HIC_LOUPE,
  MAX_HIC_LOUPES,
  MAX_HIC_SURFACES,
  VERT_FULL,
} from "../core/hicShaders.ts";
import type { ResolvedGlassConfig } from "../core/presets.ts";
import type { HicGlassBridge, HicSurfaceKind } from "./hicBridge.ts";
import { createProgram, createTexture, type WebGLProgramHandle } from "./webgl.ts";

/** Chrome 157+ HTML-in-Canvas experimental DOM extensions (runtime-guarded). */
interface HicCanvasElement extends HTMLCanvasElement {
  onpaint: ((ev: Event & { changedElements?: Element[] }) => void) | null;
  requestPaint: () => void;
  updateElementGeometry: (el: Element, transform: DOMMatrix) => void;
  getElementImageDefaultSize: (el: Element) => { width: number; height: number };
}

interface HicWebGL2Context extends WebGL2RenderingContext {
  texElementSubImage2D: (
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    element: Element,
  ) => void;
}

const HIC_CANVAS_ATTRS = {
  content: "drawable",
  layoutsubtree: "",
} as Record<string, string>;

const HIC_DRAWABLE_ATTRS = {
  drawable: "",
} as Record<string, string>;

export interface HicStageProps {
  config: ResolvedGlassConfig;
  bridge: HicGlassBridge;
  continuousScene?: boolean;
  sceneKey?: string;
  className?: string;
  sceneClassName?: string;
  chromeClassName?: string;
  onFallbackNeeded: () => void;
  sceneChildren: ReactNode;
  chromeChildren: ReactNode;
}

function surfaceKindCode(kind: HicSurfaceKind): number {
  if (kind === "glass") return 1;
  if (kind === "switch-track") return 2;
  return 3;
}

export function HicStage({
  config,
  bridge,
  continuousScene = false,
  sceneKey,
  className,
  sceneClassName,
  chromeClassName,
  onFallbackNeeded,
  sceneChildren,
  chromeChildren,
}: HicStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);
  const onFallbackRef = useRef(onFallbackNeeded);

  useEffect(() => {
    configRef.current = config;
    bridge.requestDraw();
  }, [config, bridge]);

  useEffect(() => {
    onFallbackRef.current = onFallbackNeeded;
  }, [onFallbackNeeded]);

  useEffect(() => {
    bridge.requestPaint();
  }, [sceneKey, bridge]);

  // Throttle animated canvas backdrops to ~30 Hz so texture uploads don't starve spring redraws.
  useEffect(() => {
    if (!continuousScene) return;
    const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMq.matches) return;
    let raf = 0;
    let lastPaint = 0;
    const loop = (now: number) => {
      if (!document.hidden && !reducedMq.matches && now - lastPaint >= 32) {
        lastPaint = now;
        bridge.requestPaint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [continuousScene, bridge]);

  useEffect(() => {
    const rawCanvas = canvasRef.current;
    const sceneEl = sceneRef.current;
    const chromeEl = chromeRef.current;
    if (!rawCanvas || !sceneEl || !chromeEl) return;

    const canvas = rawCanvas as HicCanvasElement;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    }) as HicWebGL2Context | null;

    if (
      !gl ||
      typeof gl.texElementSubImage2D !== "function" ||
      typeof canvas.requestPaint !== "function" ||
      typeof canvas.updateElementGeometry !== "function" ||
      typeof canvas.getElementImageDefaultSize !== "function"
    ) {
      onFallbackRef.current();
      return;
    }

    let barProg: WebGLProgramHandle;
    let loupeProg: WebGLProgramHandle;
    try {
      barProg = createProgram(gl, VERT_FULL, FRAG_HIC_BAR);
      loupeProg = createProgram(gl, VERT_FULL, FRAG_HIC_LOUPE);
    } catch {
      onFallbackRef.current();
      return;
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const measureCanvas = () => {
      const rect = rawCanvas.getBoundingClientRect();
      const nextDpr = Math.min(3, window.devicePixelRatio || 1);
      const nextVw = Math.max(1, Math.round(rect.width || window.innerWidth));
      const nextVh = Math.max(1, Math.round(rect.height || window.innerHeight));
      const nextPw = Math.max(1, Math.round(nextVw * nextDpr));
      const nextPh = Math.max(1, Math.round(nextVh * nextDpr));
      return { nextDpr, nextVw, nextVh, nextPw, nextPh };
    };

    const initial = measureCanvas();
    let dpr = initial.nextDpr;
    let vw = initial.nextVw;
    let vh = initial.nextVh;
    let pw = initial.nextPw;
    let ph = initial.nextPh;
    canvas.width = pw;
    canvas.height = ph;

    const texOpts = {
      internal: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
    };

    let sceneTex = createTexture(gl, pw, ph, texOpts);
    let sceneTexW = pw;
    let sceneTexH = ph;

    let chromeTex = createTexture(gl, pw, ph, texOpts);
    let chromeTexW = pw;
    let chromeTexH = ph;

    let barFboTex = createTexture(gl, pw, ph, texOpts);
    const barFbo = gl.createFramebuffer();
    const probeFbo = gl.createFramebuffer();
    if (!barFbo || !probeFbo) {
      onFallbackRef.current();
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, barFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, barFboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const surfRect = new Float32Array(MAX_HIC_SURFACES * 4);
    const surfMeta = new Float32Array(MAX_HIC_SURFACES * 4);
    const surfPill = new Float32Array(MAX_HIC_SURFACES * 4);
    const surfState = new Float32Array(MAX_HIC_SURFACES * 4);
    const surfKnob = new Float32Array(MAX_HIC_SURFACES * 4);
    const surfKnobH = new Float32Array(MAX_HIC_SURFACES * 4);
    const surfTouch = new Float32Array(MAX_HIC_SURFACES * 4);

    const loupeGeom = new Float32Array(MAX_HIC_LOUPES * 4);
    const loupeAnim = new Float32Array(MAX_HIC_LOUPES * 4);
    const loupeOptics = new Float32Array(MAX_HIC_LOUPES * 4);
    const loupeExtra = new Float32Array(MAX_HIC_LOUPES * 4);
    const loupeTouchR = new Float32Array(MAX_HIC_LOUPES);

    let uploadedOnce = false;
    let verifiedLiveTexture = false;
    let blankUploadRetries = 0;
    let drawRaf = 0;
    let retryRaf = 0;
    let fallbackTriggered = false;
    const probePx = new Uint8Array(4);

    const triggerFallback = () => {
      if (fallbackTriggered) return;
      fallbackTriggered = true;
      onFallbackRef.current();
    };

    /** One-time GPU readback guard: detects silent black/empty texElementSubImage2D uploads. */
    const verifySceneTexturePopulated = (): boolean => {
      if (sceneTexW < 4 || sceneTexH < 4) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return false;
      }
      let maxAlpha = 0;
      let maxRgb = 0;
      const fracs = [0.15, 0.5, 0.85];
      for (const fy of fracs) {
        const y = Math.min(sceneTexH - 1, Math.max(0, Math.floor(sceneTexH * fy)));
        for (const fx of fracs) {
          const x = Math.min(sceneTexW - 1, Math.max(0, Math.floor(sceneTexW * fx)));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probePx);
          if (probePx[3] > maxAlpha) maxAlpha = probePx[3];
          const rgb = Math.max(probePx[0], probePx[1], probePx[2]);
          if (rgb > maxRgb) maxRgb = rgb;
          if (maxAlpha > 0 && maxRgb > 0) break;
        }
        if (maxAlpha > 0 && maxRgb > 0) break;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return maxAlpha > 0 && maxRgb > 0;
    };

    const verifyChromeTexturePopulated = (): boolean => {
      if (chromeTexW < 4 || chromeTexH < 4) return false;
      const hasVisibleChrome =
        chromeEl.innerText.trim().length > 0 || Boolean(chromeEl.querySelector("svg"));
      if (!hasVisibleChrome) return true;
      const surfaces = bridge.getSurfaces();
      const canvasRect = rawCanvas.getBoundingClientRect();
      const targets =
        surfaces.length > 0
          ? surfaces.map((s) => ({
              cx:
                canvasRect.width > 0
                  ? Math.min(0.95, Math.max(0.05, (s.cx - canvasRect.left) / canvasRect.width))
                  : 0.5,
              cy:
                canvasRect.height > 0
                  ? Math.min(0.95, Math.max(0.05, 1 - (s.cy - canvasRect.top) / canvasRect.height))
                  : 0.5,
            }))
          : [{ cx: 0.5, cy: 0.5 }];

      gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, chromeTex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return false;
      }
      const patchW = Math.min(chromeTexW, 64);
      const patchH = Math.min(chromeTexH, 32);
      const patch = new Uint8Array(patchW * patchH * 4);
      let found = false;
      for (const t of targets) {
        const px0 = Math.min(
          chromeTexW - patchW,
          Math.max(0, Math.floor(chromeTexW * t.cx - patchW / 2)),
        );
        const py0 = Math.min(
          chromeTexH - patchH,
          Math.max(0, Math.floor(chromeTexH * t.cy - patchH / 2)),
        );
        gl.readPixels(px0, py0, patchW, patchH, gl.RGBA, gl.UNSIGNED_BYTE, patch);
        for (let i = 3; i < patch.length; i += 4) {
          if (patch[i] > 4) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return found;
    };

    const profileIndex = (p: ResolvedGlassConfig["profile"]) =>
      p === "circle" ? 0 : p === "c2squircle" ? 1 : 2;
    const pillModeIndex = (m: ResolvedGlassConfig["activePill"]) =>
      m === "refracting-loupe" ? 0 : m === "tint" ? 1 : 2;

    const drawWebGL = () => {
      if (!uploadedOnce || gl.isContextLost()) return;
      const c = configRef.current;
      const leg = bridge.legibility;
      const surfaces = bridge.getSurfaces();
      const loupes = bridge.getLoupes();
      const canvasRect = rawCanvas.getBoundingClientRect();
      const ox = canvasRect.left;
      const oy = canvasRect.top;

      const bodyRgb: readonly [number, number, number] = leg.adaptiveA11y
        ? leg.fgDark
          ? [250, 251, 254]
          : [12, 16, 26]
        : [c.tintColor.r, c.tintColor.g, c.tintColor.b];

      const ringRgb: readonly [number, number, number] = c.edgeRingLight
        ? [1, 1, 1]
        : [15 / 255, 18 / 255, 26 / 255];

      const angleRad = (c.lightAngleDeg * Math.PI) / 180;
      const profileId = profileIndex(c.profile);

      const sCount = Math.min(MAX_HIC_SURFACES, surfaces.length);
      for (let i = 0; i < sCount; i++) {
        const s = surfaces[i];
        const o = i * 4;
        surfRect[o] = s.cx - ox;
        surfRect[o + 1] = s.cy - oy;
        surfRect[o + 2] = s.w;
        surfRect[o + 3] = s.h;

        surfMeta[o] = surfaceKindCode(s.kind);
        surfMeta[o + 1] = s.radius;
        surfMeta[o + 2] = s.morphGroup ?? 0;
        surfMeta[o + 3] = s.mergeK ?? 0;

        surfPill[o] = (s.pillCx ?? 0) - ox;
        surfPill[o + 1] = (s.pillCy ?? 0) - oy;
        surfPill[o + 2] = s.pillW ?? 0;
        surfPill[o + 3] = s.pillH ?? 0;

        surfState[o] = s.pillAlpha ?? 0;
        surfState[o + 1] = s.fill ?? 0;
        surfState[o + 2] = s.applyScrim ? 1 : 0;
        surfState[o + 3] = s.knobAlpha ?? 0;

        surfKnob[o] = (s.knobCx ?? s.cx) - ox;
        surfKnob[o + 1] = s.knobScaleX ?? 1;
        surfKnob[o + 2] = s.knobScaleY ?? 1;
        surfKnob[o + 3] = s.knobW ?? 32;

        surfKnobH[o] = s.knobH ?? 20;
        surfKnobH[o + 1] = 0;
        surfKnobH[o + 2] = 0;
        surfKnobH[o + 3] = 0;

        surfTouch[o] = (s.touchX ?? s.cx) - ox;
        surfTouch[o + 1] = (s.touchY ?? s.cy) - oy;
        surfTouch[o + 2] = s.touchGlow ?? 0;
        surfTouch[o + 3] = s.touchRadius ?? 56;
      }

      // Pass 1: scene and glass nodes into the framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, barFbo);
      gl.viewport(0, 0, pw, ph);
      gl.useProgram(barProg.p);

      gl.uniform2f(barProg.u("uViewportCss"), vw, vh);
      gl.uniform2f(barProg.u("uBufferPx"), pw, ph);
      gl.uniform1f(barProg.u("uDpr"), dpr);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(barProg.u("uSceneTex"), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, chromeTex);
      gl.uniform1i(barProg.u("uChromeTex"), 1);

      gl.uniform1i(barProg.u("uSurfaceCount"), sCount);
      gl.uniform4fv(barProg.u("uSurfRect"), surfRect);
      gl.uniform4fv(barProg.u("uSurfMeta"), surfMeta);
      gl.uniform4fv(barProg.u("uSurfPill"), surfPill);
      gl.uniform4fv(barProg.u("uSurfState"), surfState);
      gl.uniform4fv(barProg.u("uSurfKnob"), surfKnob);
      gl.uniform4fv(barProg.u("uSurfKnobH"), surfKnobH);
      gl.uniform4fv(barProg.u("uSurfTouch"), surfTouch);

      gl.uniform1i(barProg.u("uActivePillMode"), pillModeIndex(c.activePill));
      gl.uniform1i(barProg.u("uProfile"), profileId);
      gl.uniform4f(barProg.u("uBarOptics"), c.bezel, c.thickness, c.ior, c.minJacobian);
      gl.uniform4f(barProg.u("uBarFx"), c.strength, c.dispersion, c.blur, c.saturate);
      gl.uniform4f(barProg.u("uBarTone"), c.brightness, c.contrast, c.tintAlpha, c.rimAlphaMin);
      gl.uniform3f(barProg.u("uBodyColor"), bodyRgb[0] / 255, bodyRgb[1] / 255, bodyRgb[2] / 255);
      gl.uniform4f(
        barProg.u("uScrim"),
        leg.scrimRgb[0] / 255,
        leg.scrimRgb[1] / 255,
        leg.scrimRgb[2] / 255,
        leg.adaptiveA11y ? leg.scrimAlpha : 0,
      );
      gl.uniform4f(barProg.u("uLightGeom"), angleRad, c.lightLift, c.lightExponent, c.backBounce);
      gl.uniform4f(
        barProg.u("uHiColor"),
        c.highlightColor.r / 255,
        c.highlightColor.g / 255,
        c.highlightColor.b / 255,
        c.highlightColor.a,
      );
      gl.uniform4f(
        barProg.u("uShadeColor"),
        c.shadeColor.r / 255,
        c.shadeColor.g / 255,
        c.shadeColor.b / 255,
        c.shadeColor.a,
      );
      gl.uniform4f(barProg.u("uRing"), ringRgb[0], ringRgb[1], ringRgb[2], c.edgeRingAlpha);
      gl.uniform1f(barProg.u("uShadowAlpha"), c.shadowAlpha);
      gl.uniform1i(barProg.u("uFgDark"), leg.fgDark ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: loupes to the screen
      const defaultRingAlpha =
        c.edgeRingAlpha > 0.005 ? Math.min(0.2, c.edgeRingAlpha + 0.04) : c.edgeRingAlpha;
      const defaultTintAlpha = Math.min(0.04, c.tintAlpha * 0.25);
      const lCount = Math.min(MAX_HIC_LOUPES, loupes.length);
      for (let i = 0; i < lCount; i++) {
        const l = loupes[i];
        const o = i * 4;
        loupeGeom[o] = l.cx - ox;
        loupeGeom[o + 1] = l.cy - oy;
        loupeGeom[o + 2] = l.nativeW;
        loupeGeom[o + 3] = l.nativeH;

        loupeAnim[o] = l.scaleX;
        loupeAnim[o + 1] = l.scaleY;
        loupeAnim[o + 2] = l.alpha;
        loupeAnim[o + 3] = l.pressGain;

        loupeOptics[o] = l.bezel && l.bezel > 0 ? l.bezel : c.loupeBezel;
        loupeOptics[o + 1] = l.thickness && l.thickness > 0 ? l.thickness : c.loupeThickness;
        loupeOptics[o + 2] = l.dispersionScale ?? 1.0;
        loupeOptics[o + 3] = l.tintAlpha ?? defaultTintAlpha;

        loupeExtra[o] = l.ringAlpha ?? defaultRingAlpha;
        loupeExtra[o + 1] = (l.touchX ?? l.cx) - ox;
        loupeExtra[o + 2] = (l.touchY ?? l.cy) - oy;
        loupeExtra[o + 3] = l.touchGlow ?? 0;

        loupeTouchR[i] = l.touchRadius ?? 48;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pw, ph);
      gl.useProgram(loupeProg.p);

      gl.uniform2f(loupeProg.u("uViewportCss"), vw, vh);
      gl.uniform2f(loupeProg.u("uBufferPx"), pw, ph);
      gl.uniform1f(loupeProg.u("uDpr"), dpr);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, barFboTex);
      gl.uniform1i(loupeProg.u("uBarFbo"), 0);

      gl.uniform1i(loupeProg.u("uLoupeCount"), lCount);
      gl.uniform4fv(loupeProg.u("uLoupeGeom"), loupeGeom);
      gl.uniform4fv(loupeProg.u("uLoupeAnim"), loupeAnim);
      gl.uniform4fv(loupeProg.u("uLoupeOptics"), loupeOptics);
      gl.uniform4fv(loupeProg.u("uLoupeExtra"), loupeExtra);
      gl.uniform1fv(loupeProg.u("uLoupeTouchR"), loupeTouchR);

      gl.uniform4f(
        loupeProg.u("uGlobalLoupe"),
        c.ior,
        c.minJacobian,
        c.loupeStrength,
        c.loupeDispersion,
      );
      gl.uniform1i(loupeProg.u("uProfile"), profileId);
      gl.uniform3f(loupeProg.u("uBodyColor"), bodyRgb[0] / 255, bodyRgb[1] / 255, bodyRgb[2] / 255);
      gl.uniform4f(loupeProg.u("uLightGeom"), angleRad, c.lightLift, c.lightExponent, c.backBounce);
      gl.uniform4f(
        loupeProg.u("uHiColor"),
        c.highlightColor.r / 255,
        c.highlightColor.g / 255,
        c.highlightColor.b / 255,
        c.highlightColor.a,
      );
      gl.uniform4f(
        loupeProg.u("uShadeColor"),
        c.shadeColor.r / 255,
        c.shadeColor.g / 255,
        c.shadeColor.b / 255,
        c.shadeColor.a,
      );
      gl.uniform3f(loupeProg.u("uRingColor"), ringRgb[0], ringRgb[1], ringRgb[2]);
      gl.uniform1i(loupeProg.u("uFgDark"), leg.fgDark ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const scheduleDraw = () => {
      if (drawRaf) return;
      drawRaf = requestAnimationFrame(() => {
        drawRaf = 0;
        drawWebGL();
      });
    };

    const requestPaint = () => {
      try {
        canvas.requestPaint();
      } catch {
        // ignore if detached
      }
    };

    const unbind = bridge.bind(scheduleDraw, requestPaint);

    const resize = () => {
      const m = measureCanvas();
      if (m.nextPw === pw && m.nextPh === ph && m.nextDpr === dpr) return;

      dpr = m.nextDpr;
      vw = m.nextVw;
      vh = m.nextVh;
      pw = m.nextPw;
      ph = m.nextPh;
      canvas.width = pw;
      canvas.height = ph;

      gl.deleteTexture(barFboTex);
      barFboTex = createTexture(gl, pw, ph, texOpts);
      gl.bindFramebuffer(gl.FRAMEBUFFER, barFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, barFboTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      requestPaint();
    };

    canvas.onpaint = (ev) => {
      if (gl.isContextLost() || fallbackTriggered) return;
      const changed = ev.changedElements;
      const dirtyAll = !uploadedOnce || !changed || changed.length === 0;
      const sceneDirty = dirtyAll || changed.includes(sceneEl);
      const chromeDirty = dirtyAll || changed.includes(chromeEl);

      try {
        canvas.updateElementGeometry(sceneEl, new DOMMatrix());
        canvas.updateElementGeometry(chromeEl, new DOMMatrix());
      } catch {
        // ignore transient layout state
      }

      let uploadThrew = false;
      let sceneUploaded = !sceneDirty;
      let chromeUploaded = !chromeDirty;

      while (gl.getError() !== gl.NO_ERROR) {
        // drain
      }

      // getElementImageDefaultSize may only be called inside canvas.onpaint.
      if (sceneDirty) {
        try {
          const sz = canvas.getElementImageDefaultSize(sceneEl);
          if (sz.width > 0 && sz.height > 0) {
            if (sz.width !== sceneTexW || sz.height !== sceneTexH) {
              gl.deleteTexture(sceneTex);
              sceneTex = createTexture(gl, sz.width, sz.height, texOpts);
              sceneTexW = sz.width;
              sceneTexH = sz.height;
            }
            gl.bindTexture(gl.TEXTURE_2D, sceneTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
            gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sceneEl);
            if (gl.getError() === gl.NO_ERROR) {
              sceneUploaded = true;
            } else {
              uploadThrew = true;
            }
          }
        } catch {
          uploadThrew = true;
        }
      }

      if (chromeDirty) {
        try {
          const sz = canvas.getElementImageDefaultSize(chromeEl);
          if (sz.width > 0 && sz.height > 0) {
            if (sz.width !== chromeTexW || sz.height !== chromeTexH) {
              gl.deleteTexture(chromeTex);
              chromeTex = createTexture(gl, sz.width, sz.height, texOpts);
              chromeTexW = sz.width;
              chromeTexH = sz.height;
            }
            gl.bindTexture(gl.TEXTURE_2D, chromeTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
            gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, chromeEl);
            if (gl.getError() === gl.NO_ERROR) {
              chromeUploaded = true;
            } else {
              uploadThrew = true;
            }
          }
        } catch {
          uploadThrew = true;
        }
      }

      if (!verifiedLiveTexture) {
        const texturesPopulated =
          !uploadThrew &&
          sceneUploaded &&
          chromeUploaded &&
          verifySceneTexturePopulated() &&
          verifyChromeTexturePopulated();

        if (!texturesPopulated) {
          blankUploadRetries += 1;
          if (blankUploadRetries >= 3) {
            triggerFallback();
            return;
          }
          cancelAnimationFrame(retryRaf);
          retryRaf = requestAnimationFrame(() => requestPaint());
          return;
        }
        verifiedLiveTexture = true;
      }

      uploadedOnce = true;
      drawWebGL();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(rawCanvas);
    window.addEventListener("resize", resize);
    const watchdog = window.setTimeout(() => {
      if (!verifiedLiveTexture) triggerFallback();
    }, 800);
    requestPaint();

    return () => {
      unbind();
      cancelAnimationFrame(drawRaf);
      cancelAnimationFrame(retryRaf);
      window.clearTimeout(watchdog);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      canvas.onpaint = null;
      gl.deleteTexture(sceneTex);
      gl.deleteTexture(chromeTex);
      gl.deleteTexture(barFboTex);
      gl.deleteFramebuffer(barFbo);
      gl.deleteFramebuffer(probeFbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(barProg.p);
      gl.deleteProgram(loupeProg.p);
    };
  }, [bridge]);

  return (
    <canvas
      ref={canvasRef}
      className={className ? `lgw-hic-canvas ${className}` : "lgw-hic-canvas"}
      {...HIC_CANVAS_ATTRS}
    >
      <div
        ref={sceneRef}
        className={sceneClassName ? `lgw-hic-scene ${sceneClassName}` : "lgw-hic-scene"}
        data-lgw-scroll-container="true"
        {...HIC_DRAWABLE_ATTRS}
      >
        {sceneChildren}
      </div>
      <div
        ref={chromeRef}
        className={chromeClassName ? `lgw-hic-chrome ${chromeClassName}` : "lgw-hic-chrome"}
        {...HIC_DRAWABLE_ATTRS}
      >
        {chromeChildren}
      </div>
    </canvas>
  );
}
