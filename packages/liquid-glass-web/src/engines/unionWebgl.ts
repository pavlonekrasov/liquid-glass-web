/* ===========================================================================
   Hardware WebGL2 Renderer for Tier 1 / Tier 2 GlassContainer polySmin Union.
   Renders the exact pure-SDF outer contact shadow (zero destination-out fringe),
   Beer–Lambert volumetric body absorption, adaptive WCAG AA scrim, 3D bezel-
   normal dual-bounce Schlick Fresnel (sampling the exact cached 65x65
   `dualRimTerms` LUT texture from `union.ts`), and subtle 1px optical edge
   at FULL Retina DPR on EVERY 120Hz spring frame (~0.15ms/frame).
   =========================================================================== */

import { VERT_FULL } from "../core/hicShaders.ts";
import { absorptionFor } from "../core/optics.ts";
import { getRimLut, type PolySminOpticsParams, type UnionCapsule } from "../core/union.ts";
import { createProgram, type WebGLProgramHandle } from "./webgl.ts";

const FRAG_UNION_OPTICS = /* glsl */ `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 uCanvasPx;
uniform float uScale;
uniform float uPad;
uniform vec4 uCapA;       // cx, cy, hw, hh
uniform vec4 uCapB;       // cx, cy, hw, hh
uniform vec4 uGeom;       // rA, rB, mergeK, effBezel
uniform vec4 uProfileCfg; // profileId, thickness, sigma, rimFloor
uniform vec4 uBody;       // r, g, b, borderWidth
uniform vec4 uScrim;      // r, g, b, alpha
uniform vec4 uHiColor;    // r, g, b, 0
uniform vec4 uShColor;    // r, g, b, 0
uniform vec4 uEdge;       // r, g, b, edgeAlpha
uniform vec4 uLutMeta;    // cosA, sinA, bins, shadowAlpha

uniform sampler2D uRimLut;

vec3 sdRoundedBoxGrad(vec2 p, vec2 b, float r) {
  float cr = min(r, min(b.x, b.y));
  vec2 q = abs(p) - (b - cr);
  vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  if (q.x > 0.0 && q.y > 0.0) {
    float len = length(q);
    return vec3(len - cr, s * (q / max(len, 1e-6)));
  }
  if (q.x > q.y) return vec3(q.x - cr, s.x, 0.0);
  return vec3(q.y - cr, 0.0, s.y);
}

float sdRoundedBoxDist(vec2 p, vec2 b, float r) {
  float cr = min(r, min(b.x, b.y));
  vec2 q = abs(p) - (b - cr);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - cr;
}

float sminPolyDist(vec2 pos) {
  float dA = sdRoundedBoxDist(pos - uCapA.xy, uCapA.zw, uGeom.x);
  float dB = sdRoundedBoxDist(pos - uCapB.xy, uCapB.zw, uGeom.y);
  float k = uGeom.z;
  if (k <= 0.001) return min(dA, dB);
  float h = max(k - abs(dA - dB), 0.0) / k;
  return min(dA, dB) - h * h * k * 0.25;
}

vec3 sminPolyGrad(vec2 pos) {
  vec3 a = sdRoundedBoxGrad(pos - uCapA.xy, uCapA.zw, uGeom.x);
  vec3 b = sdRoundedBoxGrad(pos - uCapB.xy, uCapB.zw, uGeom.y);
  float k = uGeom.z;
  if (k <= 0.001) return a.x <= b.x ? a : b;
  float h = max(k - abs(a.x - b.x), 0.0) / k;
  float dist = min(a.x, b.x) - h * h * k * 0.25;
  float wA = a.x <= b.x ? (1.0 - 0.5 * h) : (0.5 * h);
  vec2 g = wA * a.yz + (1.0 - wA) * b.yz;
  return vec3(dist, g);
}

float profileHeight(int pid, float x) {
  float t = clamp(x, 0.0, 1.0);
  if (pid == 0) return sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)));
  if (pid == 2) return pow(max(0.0, 1.0 - pow(1.0 - t, 4.0)), 0.25);
  float smoothT = t * t * (3.0 - 2.0 * t);
  float u = 0.45 * t + 0.55 * smoothT;
  return pow(max(0.0, 1.0 - pow(1.0 - u, 4.0)), 0.25);
}

float gaussHalfPlane(float d, float sigma) {
  float x = clamp(d / sigma, -6.0, 6.0);
  float t = tanh(0.79788456 * x * (1.0 + 0.044715 * x * x));
  return 0.5 - 0.5 * t;
}

void main() {
  vec2 cssPos = vec2(
    gl_FragCoord.x / uScale - uPad,
    (uCanvasPx.y - gl_FragCoord.y) / uScale - uPad
  );
  float pixel = 1.0 / uScale;
  float halfPx = pixel * 0.5;

  vec3 sg = sminPolyGrad(cssPos);
  float dist = sg.x;
  float coverage = clamp(0.5 - dist / pixel, 0.0, 1.0);

  // Pure analytical Gaussian half-plane convolution for CSS box-shadow parity
  // (0 1px 3px + 0 6px 18px) strictly on the (1 - coverage) exterior area.
  float shAlpha = uLutMeta.w;
  float outerShadowA = 0.0;
  if (shAlpha > 0.001 && coverage < 0.999 && dist < 30.0) {
    float dNear = sminPolyDist(cssPos - vec2(0.0, 1.0));
    float dFar = sminPolyDist(cssPos - vec2(0.0, 6.0));
    float shNear = gaussHalfPlane(dNear, 1.5) * (shAlpha * 0.52);
    float shFar = gaussHalfPlane(dFar, 9.0) * (shAlpha * 0.72);
    float rawShadow = clamp(shNear + shFar * (1.0 - shNear), 0.0, 1.0);
    outerShadowA = rawShadow * (1.0 - coverage);
  }

  vec3 shadowRgb = vec3(15.0 / 255.0, 20.0 / 255.0, 32.0 / 255.0);
  if (coverage <= 0.0) {
    fragColor = vec4(shadowRgb * outerShadowA, outerShadowA);
    return;
  }

  float s = -dist;
  float effBezel = uGeom.w;
  float borderW = uBody.w;

  // Match the exact W3C CSS stacking order inside .lgw-glass-surface (isolation: isolate):
  //   1. element 1px border (bottom) -> 2. ::before body tint -> 3. .lgw-scrim -> 4. ::after 3D Fresnel (top)
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // 1. Subtle 1px optical outer border (bottom layer, matches .lgw-glass-surface border)
  if (borderW > 0.0 && uEdge.a > 0.005 && s - halfPx < borderW) {
    float overlap = max(0.0, min(borderW, s + halfPx) - max(0.0, s - halfPx)) / pixel;
    float eA = uEdge.a * overlap;
    if (eA > 1e-5) {
      col = uEdge.rgb;
      alpha = eA;
    }
  }

  // 2. Beer–Lambert volumetric body absorption (::before, painted over border)
  float sBody = min(max(s, 0.0) + borderW, effBezel);
  int pid = int(uProfileCfg.x + 0.5);
  float h = uProfileCfg.y * profileHeight(pid, sBody / effBezel);
  float bodyA = max(uProfileCfg.w, 1.0 - exp(-uProfileCfg.z * h));
  if (bodyA > 1e-5) {
    float outA = bodyA + alpha * (1.0 - bodyA);
    if (outA > 1e-6) {
      col = (uBody.rgb * bodyA + col * alpha * (1.0 - bodyA)) / outA;
    }
    alpha = outA;
  }

  // 3. Adaptive WCAG AA scrim (.lgw-scrim, painted over ::before)
  if (uScrim.a > 0.005) {
    float outA = uScrim.a + alpha * (1.0 - uScrim.a);
    if (outA > 1e-6) {
      col = (uScrim.rgb * uScrim.a + col * alpha * (1.0 - uScrim.a)) / outA;
    }
    alpha = outA;
  }

  // 4. 3D bezel-normal dual-bounce Schlick Fresnel (::after, painted ON TOP of border + body + scrim)
  if (s < effBezel) {
    float gLen = length(sg.yz);
    if (gLen > 1e-4) {
      vec2 n = sg.yz / gLen;
      float saddleDamp = clamp((gLen - 0.15) / 0.6, 0.0, 1.0);
      float dotNL = clamp(n.x * uLutMeta.x + n.y * uLutMeta.y, -1.0, 1.0);
      float bins = uLutMeta.z;
      float texSize = bins + 1.0;
      float u = ((dotNL * 0.5 + 0.5) * bins + 0.5) / texSize;
      float v = (clamp(max(s, 0.0) / effBezel, 0.0, 1.0) * bins + 0.5) / texSize;
      vec2 lutSample = texture(uRimLut, vec2(u, v)).rg;
      float hA = lutSample.r * saddleDamp;
      float sA = lutSample.g * saddleDamp;
      float rimA = hA + sA * (1.0 - hA);
      if (rimA > 1e-5) {
        float wh = hA;
        float ws = sA * (1.0 - hA);
        vec3 litCol = (uHiColor.rgb * wh + uShColor.rgb * ws) / max(wh + ws, 1e-6);
        float outA = rimA + alpha * (1.0 - rimA);
        col = (litCol * rimA + col * alpha * (1.0 - rimA)) / outA;
        alpha = outA;
      }
    }
  }

  float gA = clamp(alpha * coverage, 0.0, 1.0);
  vec3 premul = col * gA + shadowRgb * outerShadowA;
  float outA = clamp(gA + outerShadowA, 0.0, 1.0);
  fragColor = vec4(premul, outA);
}
`;

export interface UnionWebGLRenderer {
  render: (
    widthCss: number,
    heightCss: number,
    a: UnionCapsule,
    b: UnionCapsule,
    k: number,
    params: PolySminOpticsParams,
  ) => boolean;
  destroy: () => void;
}

export function createUnionWebGLRenderer(canvas: HTMLCanvasElement): UnionWebGLRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  let prog: WebGLProgramHandle | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let lutTex: WebGLTexture | null = null;

  try {
    prog = createProgram(gl, VERT_FULL, FRAG_UNION_OPTICS);
    vao = gl.createVertexArray();
    lutTex = gl.createTexture();
    if (!vao || !lutTex) throw new Error("Failed to allocate WebGL2 union resources");
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } catch {
    if (lutTex) gl.deleteTexture(lutTex);
    if (vao) gl.deleteVertexArray(vao);
    if (prog) gl.deleteProgram(prog.p);
    return null;
  }

  let uploadedLutKey = "";
  let lutRgba: Uint8Array | null = null;

  return {
    render(widthCss, heightCss, a, b, k, params) {
      if (!prog || !vao || !lutTex || gl.isContextLost()) return false;

      const pad = Math.max(0, params.padCss ?? 0);
      const totalW = widthCss + pad * 2;
      const totalH = heightCss + pad * 2;
      const pw = Math.max(2, Math.round(totalW * params.scale));
      const ph = Math.max(2, Math.round(totalH * params.scale));
      const effScale = pw / totalW;

      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }

      const rA = Math.min(a.r, a.hw, a.hh);
      const rB = Math.min(b.r, b.hw, b.hh);
      const effBezel = Math.max(2, Math.min(params.optics.bezel, Math.min(rA, rB)));
      const effOptics = { ...params.optics, bezel: effBezel };
      const pixel = 1 / effScale;

      const lut = getRimLut(effOptics, params.lighting, pixel);
      if (uploadedLutKey !== lut.key) {
        const size = lut.bins + 1;
        const count = size * size;
        if (!lutRgba || lutRgba.length !== count * 4) {
          lutRgba = new Uint8Array(count * 4);
        }
        for (let i = 0; i < count; i++) {
          const o = i * 4;
          lutRgba[o] = Math.round(255 * Math.min(1, Math.max(0, lut.hA[i])));
          lutRgba[o + 1] = Math.round(255 * Math.min(1, Math.max(0, lut.sA[i])));
          lutRgba[o + 2] = 0;
          lutRgba[o + 3] = 255;
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutRgba);
        uploadedLutKey = lut.key;
      }

      const sigma = absorptionFor(params.bodyAlpha, effOptics.thickness);
      const rimFloor = Math.min(params.rimAlphaMin, params.bodyAlpha);
      const profileId =
        effOptics.profile === "circle" ? 0 : effOptics.profile === "c2squircle" ? 1 : 2;

      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(prog.p);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.uniform1i(prog.u("uRimLut"), 0);

      gl.uniform2f(prog.u("uCanvasPx"), pw, ph);
      gl.uniform1f(prog.u("uScale"), effScale);
      gl.uniform1f(prog.u("uPad"), pad);
      gl.uniform4f(prog.u("uCapA"), a.cx, a.cy, a.hw, a.hh);
      gl.uniform4f(prog.u("uCapB"), b.cx, b.cy, b.hw, b.hh);
      gl.uniform4f(prog.u("uGeom"), rA, rB, k, effBezel);
      gl.uniform4f(prog.u("uProfileCfg"), profileId, effOptics.thickness, sigma, rimFloor);
      gl.uniform4f(
        prog.u("uBody"),
        params.bodyRgb.r / 255,
        params.bodyRgb.g / 255,
        params.bodyRgb.b / 255,
        params.borderWidth,
      );
      gl.uniform4f(
        prog.u("uScrim"),
        params.scrimRgb.r / 255,
        params.scrimRgb.g / 255,
        params.scrimRgb.b / 255,
        params.scrimAlpha,
      );
      gl.uniform4f(
        prog.u("uHiColor"),
        params.lighting.highlight.r / 255,
        params.lighting.highlight.g / 255,
        params.lighting.highlight.b / 255,
        0,
      );
      gl.uniform4f(
        prog.u("uShColor"),
        params.lighting.shade.r / 255,
        params.lighting.shade.g / 255,
        params.lighting.shade.b / 255,
        0,
      );
      gl.uniform4f(
        prog.u("uEdge"),
        params.edgeRgb.r / 255,
        params.edgeRgb.g / 255,
        params.edgeRgb.b / 255,
        params.edgeAlpha,
      );
      gl.uniform4f(
        prog.u("uLutMeta"),
        lut.cosA,
        lut.sinA,
        lut.bins,
        params.shadowAlpha ?? 0,
      );

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },
    destroy() {
      if (lutTex) gl.deleteTexture(lutTex);
      if (vao) gl.deleteVertexArray(vao);
      if (prog) gl.deleteProgram(prog.p);
      lutTex = null;
      vao = null;
      prog = null;
    },
  };
}
