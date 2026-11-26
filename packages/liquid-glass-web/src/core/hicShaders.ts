export const MAX_HIC_SURFACES = 8;
export const MAX_HIC_LOUPES = 4;

export interface HicSpectralBand {
  readonly nm: number;
  readonly um: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Helium d-line reference wavelength (587.6 nm in micrometers). */
export const CAUCHY_LAMBDA_D_UM = 0.5876;

/** 11-band spectrum (656 nm to 435 nm). Channel weights sum to 1, so neutral areas stay neutral. */
export const HIC_SPECTRAL_BANDS: readonly HicSpectralBand[] = [
  { nm: 656, um: 0.6563, r: 0.19, g: 0.0, b: 0.0 },
  { nm: 632, um: 0.632, r: 0.27, g: 0.03, b: 0.0 },
  { nm: 608, um: 0.608, r: 0.26, g: 0.09, b: 0.0 },
  { nm: 588, um: 0.5876, r: 0.19, g: 0.16, b: 0.0 },
  { nm: 568, um: 0.568, r: 0.09, g: 0.21, b: 0.0 },
  { nm: 546, um: 0.5461, r: 0.0, g: 0.22, b: 0.02 },
  { nm: 522, um: 0.522, r: 0.0, g: 0.17, b: 0.09 },
  { nm: 498, um: 0.498, r: 0.0, g: 0.09, b: 0.19 },
  { nm: 476, um: 0.476, r: 0.0, g: 0.03, b: 0.26 },
  { nm: 456, um: 0.456, r: 0.0, g: 0.0, b: 0.25 },
  { nm: 435, um: 0.4358, r: 0.0, g: 0.0, b: 0.19 },
];

/** Maximum Cauchy B coefficient (um^2) at UI dispersion = 1.0. */
export const MAX_CAUCHY_B = 0.06;

/** Exact Cauchy refractive index n(lambda) = n_d + B * (1/lambda^2 - 1/lambda_d^2). */
export function cauchyIor(iorD: number, lambdaUm: number, dispersion: number): number {
  const b = Math.max(0, Math.min(1, dispersion)) * MAX_CAUCHY_B;
  const invD2 = 1 / (CAUCHY_LAMBDA_D_UM * CAUCHY_LAMBDA_D_UM);
  const invL2 = 1 / (lambdaUm * lambdaUm);
  return Math.max(1.02, iorD + b * (invL2 - invD2));
}

/**
 * Polynomial C1 smooth-minimum (Inigo Quilez) for GlassContainer meniscus fusion.
 * When two surfaces have gap g, at midpoint a = b = g/2 -> smin = g/2 - k/4,
 * kissing cleanly at gap = k/2.
 */
export function polySmin(a: number, b: number, k: number): number {
  if (k <= 0.001) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export const VERT_FULL = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GLSL_BAND_INV_L2 = HIC_SPECTRAL_BANDS.map((b) => (1 / (b.um * b.um)).toFixed(5)).join(", ");
const GLSL_BAND_WEIGHTS = HIC_SPECTRAL_BANDS.map(
  (b) => `vec3(${b.r.toFixed(2)}, ${b.g.toFixed(2)}, ${b.b.toFixed(2)})`,
).join(",\n  ");

const GLSL_SHARED_OPTICS = /* glsl */ `
const float CAUCHY_INV_D2 = ${(1 / (CAUCHY_LAMBDA_D_UM * CAUCHY_LAMBDA_D_UM)).toFixed(5)};
const float MAX_CAUCHY_B = ${MAX_CAUCHY_B.toFixed(4)};
const float BAND_INV_L2[11] = float[11](${GLSL_BAND_INV_L2});
const vec3 BAND_WEIGHTS[11] = vec3[11](
  ${GLSL_BAND_WEIGHTS}
);

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sminPoly(float a, float b, float k) {
  if (k <= 0.001) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

vec2 sdGrad(vec2 p, vec2 b, float r) {
  vec2 e = vec2(0.15, 0.0);
  float gx = sdRoundedBox(p + e.xy, b, r) - sdRoundedBox(p - e.xy, b, r);
  float gy = sdRoundedBox(p + e.yx, b, r) - sdRoundedBox(p - e.yx, b, r);
  float len = length(vec2(gx, gy));
  return len > 1e-5 ? vec2(gx, gy) / len : vec2(0.0, -1.0);
}

// Height profile f(x) strictly enforcing h(0) = 0, h(1) = 1, h'(1) = 0
// mode: 0 = circle, 1 = c2squircle, 2 = squircle
float profileH(int mode, float x) {
  float t = clamp(x, 0.0, 1.0);
  if (mode == 0) {
    return sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)));
  }
  if (mode == 1) {
    float sm = t * t * (3.0 - 2.0 * t);
    t = mix(t, sm, 0.55);
  }
  float om = 1.0 - t;
  return pow(max(0.0, 1.0 - om * om * om * om), 0.25);
}

float profileSlope(int mode, float s, float bezel, float thickness) {
  float x = clamp(s / max(0.001, bezel), 0.0, 1.0);
  float dx = 0.0005;
  float a = min(1.0, x + dx);
  float b = max(0.0, x - dx);
  float df = (profileH(mode, a) - profileH(mode, b)) / max(1e-5, a - b);
  return (thickness / max(0.001, bezel)) * df;
}

// Single-interface Float32 Snell refraction with fold-free Jacobian guard
float snellDisplacement(
  int mode,
  float s,
  float bezel,
  float thickness,
  float ior,
  float strength,
  float minJacobian
) {
  if (s <= 0.0 || s >= bezel || strength <= 0.0001) return 0.0;
  float h = thickness * profileH(mode, s / bezel);
  float m = profileSlope(mode, s, bezel, thickness);
  float t1 = atan(m);
  float sinT2 = clamp(sin(t1) / max(1.01, ior), -0.9995, 0.9995);
  float t2 = asin(sinT2);
  float d = h * tan(t1 - t2) * strength;
  float maxSafe = (1.0 - clamp(minJacobian, 0.20, 0.55)) * (bezel - s);
  return min(d, maxSafe);
}

float fresnelSchlick(float cosTheta, float ior) {
  float r0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  return r0 + (1.0 - r0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

// 4-sub-sample box-filtered 3D bezel-normal dual-bounce Schlick Fresnel (DPR-invariant 1x-3x)
vec2 bezelDualFresnel(
  int mode,
  float s,
  vec2 grad,
  float bezel,
  float thickness,
  float ior,
  float angleRad,
  float lift,
  float exponent,
  float backBounce,
  float pixelCss
) {
  if (s - pixelCss * 0.5 >= bezel || bezel <= 0.01) return vec2(0.0);
  vec2 dir = vec2(cos(angleRad), sin(angleRad));
  vec3 L1 = normalize(vec3(dir.x, dir.y, lift));
  vec3 L2 = normalize(vec3(-dir.x, -dir.y, lift * 0.7));
  float r0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float bounceExp = exponent + 0.4;

  float hiAcc = 0.0;
  float shAcc = 0.0;
  float s0 = max(0.001, s - pixelCss * 0.5);
  float s1 = min(bezel, s + pixelCss * 0.5);
  float span = max(0.0001, s1 - s0);

  for (int k = 0; k < 4; k++) {
    float sk = s0 + span * ((float(k) + 0.5) * 0.25);
    float m = profileSlope(mode, max(sk, 0.02), bezel, thickness);
    float q = 1.0 / sqrt(m * m + 1.0);
    float p = m * q;
    float F = (fresnelSchlick(q, ior) - r0) / max(1e-5, 1.0 - r0);
    vec3 N = vec3(p * grad.x, p * grad.y, q);
    float f1 = max(0.0, dot(N, L1));
    float f2 = max(0.0, dot(N, L2));
    float primary = pow(f1, exponent);
    float bounce = backBounce * pow(f2, bounceExp);
    hiAcc += F * min(1.0, primary + bounce);
    shAcc += F * max(0.0, 1.0 - f1 - bounce);
  }
  float norm = (span / max(0.001, pixelCss)) * 0.25;
  return vec2(clamp(hiAcc * norm * 2.25, 0.0, 1.0), clamp(shAcc * norm * 1.45, 0.0, 1.0));
}

// Chroma-preserving tucked Gaussian elevation shadow driven by two SDF offsets
vec3 applyGlassShadowFromDistances(
  vec3 bgColor,
  float dContactRaw,
  float dAmbientRaw,
  float strength,
  float spreadSigma
) {
  if (strength <= 0.002) return bgColor;
  float dContact = max(0.0, dContactRaw + 2.0);
  float contact = exp(-(dContact * dContact) / (2.0 * 2.8 * 2.8));
  float dAmbient = max(0.0, dAmbientRaw + 6.0);
  float ambient = exp(-(dAmbient * dAmbient) / (2.0 * spreadSigma * spreadSigma));

  float s = clamp(contact * (strength * 0.42) + ambient * (strength * 0.92), 0.0, 0.28);
  vec3 safeBg = max(bgColor, vec3(0.0001));
  return pow(safeBg, vec3(1.0 + s * 0.32)) * (1.0 - s * 0.88);
}

vec3 applyGlassElevationShadow(
  vec3 bgColor,
  vec2 lp,
  vec2 halfSize,
  float radius,
  float strength,
  float yOffset,
  float spreadSigma
) {
  if (strength <= 0.002) return bgColor;
  float dContactRaw = sdRoundedBox(lp - vec2(0.0, 1.5), halfSize, radius);
  float dAmbientRaw = sdRoundedBox(lp - vec2(0.0, yOffset), halfSize, radius);
  return applyGlassShadowFromDistances(bgColor, dContactRaw, dAmbientRaw, strength, spreadSigma);
}

// .interactive() whisper-subtle interior crystal sheen + radiant Fresnel rim catch
vec3 applyTouchIllumination(
  vec3 glassCol,
  vec2 px,
  vec2 touchPos,
  float touchGlow,
  float touchRadius,
  float fresnelSpec,
  int fgDark
) {
  if (touchGlow <= 0.003 || touchRadius <= 1.0) return glassCol;
  vec2 d = px - touchPos;
  float r = max(24.0, touchRadius);
  float core = exp(-dot(d, d) / (2.0 * r * r));
  float innerSheen = (fgDark == 1 ? 0.045 : 0.07) * core;
  float rimSheen = (fgDark == 1 ? 0.16 : 0.22) * core * fresnelSpec;
  float gain = touchGlow * (innerSheen + rimSheen);
  return mix(glassCol, vec3(1.0), clamp(gain, 0.0, 0.28));
}

// 13-tap golden-angle Poisson/Gaussian optical frost tap
vec3 sampleOpticalFrost(sampler2D tex, vec2 px, vec2 viewportCss, float radiusCss) {
  vec2 baseUv = clamp(vec2(px.x / viewportCss.x, 1.0 - px.y / viewportCss.y), vec2(0.0005), vec2(0.9995));
  if (radiusCss <= 0.08) return texture(tex, baseUv).rgb;

  vec3 acc = texture(tex, baseUv).rgb * 0.22;
  float wSum = 0.22;
  const float GOLDEN = 2.39996323;
  for (int i = 1; i <= 12; i++) {
    float fi = float(i);
    float frac = sqrt(fi / 12.0);
    float ang = fi * GOLDEN;
    vec2 offs = vec2(cos(ang), sin(ang)) * (radiusCss * frac * 1.45);
    vec2 sp = px + offs;
    vec2 suv = clamp(vec2(sp.x / viewportCss.x, 1.0 - sp.y / viewportCss.y), vec2(0.0005), vec2(0.9995));
    float w = exp(-2.2 * frac * frac);
    acc += texture(tex, suv).rgb * w;
    wSum += w;
  }
  return acc / wSum;
}

// 11-tap continuous Float32 Cauchy-Snell spectral refraction
vec3 sampleCauchyRefraction(
  sampler2D tex,
  vec2 px,
  vec2 viewportCss,
  vec2 grad,
  int profileMode,
  float s,
  float bezel,
  float thickness,
  float iorD,
  float strength,
  float minJacobian,
  float dispersion,
  float blurRadiusCss
) {
  if (s <= 0.0 || s >= bezel || strength <= 0.0001) {
    return sampleOpticalFrost(tex, px, viewportCss, blurRadiusCss);
  }
  if (dispersion <= 0.005) {
    float d = snellDisplacement(profileMode, s, bezel, thickness, iorD, strength, minJacobian);
    return sampleOpticalFrost(tex, px - grad * d, viewportCss, blurRadiusCss);
  }

  float B = clamp(dispersion, 0.0, 1.0) * MAX_CAUCHY_B;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 11; k++) {
    float nLambda = max(1.02, iorD + B * (BAND_INV_L2[k] - CAUCHY_INV_D2));
    float d = snellDisplacement(profileMode, s, bezel, thickness, nLambda, strength, minJacobian);
    vec2 sp = px - grad * d;
    vec3 tap = sampleOpticalFrost(tex, sp, viewportCss, blurRadiusCss);
    acc += tap * BAND_WEIGHTS[k];
  }
  return acc;
}
`;

export const FRAG_HIC_BAR = /* glsl */ `#version 300 es
precision highp float;

const int MAX_SURFACES = ${MAX_HIC_SURFACES};

uniform vec2 uViewportCss;
uniform vec2 uBufferPx;
uniform float uDpr;
uniform sampler2D uSceneTex;
uniform sampler2D uChromeTex;

uniform int uSurfaceCount;
uniform vec4 uSurfRect[MAX_SURFACES];   // (cx, cy, w, h)
uniform vec4 uSurfMeta[MAX_SURFACES];   // (kind: 1=glass 2=switch 3=slider, radius, morphGroup, mergeK)
uniform vec4 uSurfPill[MAX_SURFACES];   // (pillCx, pillCy, pillW, pillH)
uniform vec4 uSurfState[MAX_SURFACES];  // (pillAlpha, fill, applyScrim, knobAlpha)
uniform vec4 uSurfKnob[MAX_SURFACES];   // (knobCx, knobScaleX, knobScaleY, knobW)
uniform vec4 uSurfKnobH[MAX_SURFACES];  // (knobH, 0, 0, 0)
uniform vec4 uSurfTouch[MAX_SURFACES];  // (touchX, touchY, touchGlow, touchRadius)

uniform int uActivePillMode; // 0 = refracting-loupe, 1 = tint, 2 = ink
uniform int uProfile;
uniform vec4 uBarOptics;    // (bezel, thickness, ior, minJacobian)
uniform vec4 uBarFx;        // (strength, dispersion, blur, saturate)
uniform vec4 uBarTone;      // (brightness, contrast, tintAlpha, rimAlphaMin)
uniform vec3 uBodyColor;
uniform vec4 uScrim;        // (r, g, b, alpha)
uniform vec4 uLightGeom;    // (angleRad, lift, exponent, backBounce)
uniform vec4 uHiColor;
uniform vec4 uShadeColor;
uniform vec4 uRing;
uniform float uShadowAlpha;
uniform int uFgDark;

out vec4 fragColor;

${GLSL_SHARED_OPTICS}

float evalMorphGroupSdf(int g, vec2 px, out float maxRadius) {
  float d = 1e6;
  bool hasAny = false;
  maxRadius = 24.0;
  for (int i = 0; i < MAX_SURFACES; i++) {
    if (i >= uSurfaceCount) break;
    if (int(uSurfMeta[i].x + 0.5) != 1) continue;
    if (int(uSurfMeta[i].z + 0.5) != g) continue;
    vec4 r = uSurfRect[i];
    if (r.z <= 2.0 || r.w <= 2.0) continue;
    float rad = uSurfMeta[i].y;
    float di = sdRoundedBox(px - r.xy, r.zw * 0.5, rad);
    if (!hasAny) {
      d = di;
      maxRadius = rad;
      hasAny = true;
    } else {
      d = sminPoly(d, di, uSurfMeta[i].w);
      maxRadius = max(maxRadius, rad);
    }
  }
  return d;
}

vec2 evalMorphGroupGrad(int g, vec2 px, out float gradMag) {
  vec2 e = vec2(0.25, 0.0);
  float dummy = 0.0;
  float gx = evalMorphGroupSdf(g, px + e.xy, dummy) - evalMorphGroupSdf(g, px - e.xy, dummy);
  float gy = evalMorphGroupSdf(g, px + e.yx, dummy) - evalMorphGroupSdf(g, px - e.yx, dummy);
  float rawLen = length(vec2(gx, gy));
  gradMag = clamp(rawLen / (2.0 * e.x), 0.0, 1.0);
  return rawLen > 1e-5 ? vec2(gx, gy) / rawLen : vec2(0.0, -1.0);
}

vec3 shadeGlassField(
  vec3 bgColor,
  vec2 px,
  float dist,
  float dContactRaw,
  float dAmbientRaw,
  vec2 grad,
  float gradMag,
  float effRadius,
  bool applyScrim,
  int groupOrIndex,
  bool isMorphGroup
) {
  vec3 outCol = applyGlassShadowFromDistances(bgColor, dContactRaw, dAmbientRaw, uShadowAlpha, 10.0);

  float aa = max(0.5, 0.7 / max(1.0, uDpr));
  float cov = 1.0 - smoothstep(-aa, aa, dist);
  if (cov <= 0.001) return outCol;

  float s = max(0.0, -dist);
  float bezel = min(uBarOptics.x, effRadius);
  float saddleSmooth = smoothstep(0.05, 0.85, gradMag);

  vec3 refr = sampleCauchyRefraction(
    uSceneTex,
    px,
    uViewportCss,
    grad,
    uProfile,
    s,
    bezel,
    uBarOptics.y,
    uBarOptics.z,
    uBarFx.x * saddleSmooth,
    uBarOptics.w,
    uBarFx.y,
    uBarFx.z
  );

  float luma = dot(refr, vec3(0.2126, 0.7152, 0.0722));
  refr = mix(vec3(luma), refr, uBarFx.w);
  refr = clamp((refr - 0.5) * uBarTone.y + 0.5, 0.0, 1.0);
  refr = clamp(refr * uBarTone.x, 0.0, 1.0);

  float h = uBarOptics.y * profileH(uProfile, s / max(0.001, bezel));
  float pAlpha = clamp(uBarTone.z, 0.0, 0.98);
  float sigma = pAlpha > 0.001 ? -log(1.0 - pAlpha) / max(0.001, uBarOptics.y) : 0.0;
  float bodyA = max(min(uBarTone.w, pAlpha), 1.0 - exp(-sigma * h));
  refr = mix(refr, uBodyColor, bodyA);

  if (applyScrim && uScrim.a > 0.003) {
    refr = mix(refr, uScrim.rgb, uScrim.a);
  }

  for (int i = 0; i < MAX_SURFACES; i++) {
    if (i >= uSurfaceCount) break;
    if (isMorphGroup) {
      if (int(uSurfMeta[i].x + 0.5) != 1 || int(uSurfMeta[i].z + 0.5) != groupOrIndex) continue;
    } else if (i != groupOrIndex) {
      continue;
    }
    float pillA = uSurfState[i].x;
    if (pillA > 0.005) {
      vec4 pr = uSurfPill[i];
      vec2 tp = px - pr.xy;
      vec2 tHalf = pr.zw * 0.5;
      float tR = min(tHalf.x, tHalf.y);
      float td = sdRoundedBox(tp, tHalf, tR);
      float tCov = (1.0 - smoothstep(-aa, aa, td)) * pillA;
      if (tCov > 0.001) {
        if (uActivePillMode == 2) {
          refr = mix(refr, vec3(23.0, 26.0, 33.0) / 255.0, tCov);
        } else {
          vec3 pillCol = uFgDark == 1 ? vec3(12.0, 16.0, 24.0) / 255.0 : vec3(1.0);
          float alpha = uFgDark == 1 ? 0.095 : 0.16;
          refr = mix(refr, pillCol, alpha * tCov);
        }
      }
    }
  }

  vec2 fres = bezelDualFresnel(
    uProfile,
    s,
    grad,
    bezel,
    uBarOptics.y,
    uBarOptics.z,
    uLightGeom.x,
    uLightGeom.y,
    uLightGeom.z,
    uLightGeom.w,
    1.0 / max(1.0, uDpr)
  ) * saddleSmooth;

  for (int i = 0; i < MAX_SURFACES; i++) {
    if (i >= uSurfaceCount) break;
    if (isMorphGroup) {
      if (int(uSurfMeta[i].x + 0.5) != 1 || int(uSurfMeta[i].z + 0.5) != groupOrIndex) continue;
    } else if (i != groupOrIndex) {
      continue;
    }
    vec4 tch = uSurfTouch[i];
    if (tch.z > 0.003) {
      refr = applyTouchIllumination(refr, px, tch.xy, tch.z, tch.w, fres.x, uFgDark);
    }
  }

  float hiA = fres.x * uHiColor.a;
  float shA = fres.y * uShadeColor.a * (1.0 - hiA);
  refr = mix(refr, uShadeColor.rgb, shA);
  refr = mix(refr, uHiColor.rgb, hiA);

  if (uRing.a > 0.004) {
    float ringBand = 1.0 - smoothstep(0.0, 1.15, abs(dist));
    refr = mix(refr, uRing.rgb, ringBand * uRing.a);
  }

  return mix(outCol, refr, cov);
}

vec3 shadeSwitchTrack(vec3 color, vec2 px, int i) {
  vec4 rect = uSurfRect[i];
  vec4 st = uSurfState[i];
  vec4 kn = uSurfKnob[i];
  vec4 tch = uSurfTouch[i];
  float aa = max(0.5, 0.7 / max(1.0, uDpr));

  vec2 sp = px - rect.xy;
  vec2 tHalf = rect.zw * 0.5;
  float tRad = min(tHalf.x, tHalf.y);
  float td = sdRoundedBox(sp, tHalf, tRad);
  float tCov = 1.0 - smoothstep(-aa, aa, td);
  if (tCov > 0.001) {
    vec3 frost = sampleOpticalFrost(uSceneTex, px, uViewportCss, 5.0);
    vec3 offCol = mix(frost, vec3(120.0, 124.0, 136.0) / 255.0, 0.42);
    vec3 onCol = vec3(52.0, 199.0, 89.0) / 255.0;
    vec3 trCol = mix(offCol, onCol, clamp(st.y, 0.0, 1.0));
    float innerDepth = smoothstep(4.0, 0.0, sp.y + tHalf.y) * 0.14;
    trCol *= (1.0 - innerDepth);
    if (tch.z > 0.003) {
      trCol = applyTouchIllumination(trCol, px, tch.xy, tch.z * 0.75, tch.w, 0.35, 0);
    }
    float rimBand = 1.0 - smoothstep(0.0, 1.1, abs(td));
    trCol = mix(trCol, vec3(1.0), rimBand * 0.22);

    vec2 onP = sp - vec2(-tHalf.x + 12.0, 0.0);
    float onBar = 1.0 - smoothstep(0.0, 0.7, sdRoundedBox(onP, vec2(0.85, 4.5), 0.8));
    trCol = mix(trCol, vec3(1.0), onBar * 0.90 * clamp(st.y, 0.0, 1.0));

    vec2 offP = sp - vec2(tHalf.x - 12.0, 0.0);
    float offRing = 1.0 - smoothstep(0.0, 0.7, abs(length(offP) - 3.6) - 0.75);
    trCol = mix(trCol, vec3(1.0), offRing * 0.68 * (1.0 - clamp(st.y, 0.0, 1.0)));

    color = mix(color, trCol, tCov);
  }

  if (st.w > 0.005) {
    vec2 kHalf = vec2(max(4.0, kn.w) * 0.5, max(4.0, uSurfKnobH[i].x) * 0.5);
    float kR = min(kHalf.x, kHalf.y);
    vec2 kp = (px - vec2(kn.x, rect.y)) / max(vec2(0.01), vec2(kn.y, kn.z));
    float kd = sdRoundedBox(kp, kHalf, kR);
    float dThumbShad = max(0.0, sdRoundedBox(kp - vec2(0.0, 1.5), max(vec2(1.0), kHalf - 1.0), max(1.0, kR - 1.0)));
    float kShad = exp(-(dThumbShad * dThumbShad) / (2.0 * 2.2 * 2.2)) * 0.11 * st.w;
    color *= (1.0 - kShad);
    float kCov = (1.0 - smoothstep(-aa, aa, kd)) * st.w;
    color = mix(color, vec3(1.0), kCov);
  }
  return color;
}

vec3 shadeSliderTrack(vec3 color, vec2 px, int i) {
  vec4 rect = uSurfRect[i];
  vec4 st = uSurfState[i];
  vec4 kn = uSurfKnob[i];
  vec4 tch = uSurfTouch[i];
  float aa = max(0.5, 0.7 / max(1.0, uDpr));

  vec2 sp = px - rect.xy;
  vec2 tHalf = rect.zw * 0.5;
  float tRad = min(tHalf.x, tHalf.y);
  float td = sdRoundedBox(sp, tHalf, tRad);
  float tCov = 1.0 - smoothstep(-aa, aa, td);
  if (tCov > 0.001) {
    vec3 frost = sampleOpticalFrost(uSceneTex, px, uViewportCss, 4.0);
    vec3 railBase = uFgDark == 1
      ? mix(frost, vec3(15.0, 20.0, 32.0) / 255.0, 0.24)
      : mix(frost, vec3(255.0, 255.0, 255.0) / 255.0, 0.28);
    float fillEdge = -tHalf.x + rect.z * clamp(st.y, 0.0, 1.0);
    float fillCov = 1.0 - smoothstep(-aa, aa, sp.x - fillEdge);
    vec3 accentCol = vec3(10.0, 132.0, 255.0) / 255.0;
    vec3 trCol = mix(railBase, accentCol, fillCov * 0.94);

    float innerShade = smoothstep(2.5, 0.0, sp.y + tHalf.y) * 0.14;
    trCol *= (1.0 - innerShade);
    if (tch.z > 0.003) {
      trCol = applyTouchIllumination(trCol, px, tch.xy, tch.z * 0.8, tch.w, 0.4, 0);
    }
    float rimBand = 1.0 - smoothstep(0.0, 1.0, abs(td));
    trCol = mix(trCol, vec3(1.0), rimBand * 0.26);

    color = mix(color, trCol, tCov);
  }

  if (st.w > 0.005) {
    vec2 kHalf = vec2(max(4.0, kn.w) * 0.5, max(4.0, uSurfKnobH[i].x) * 0.5);
    float kR = min(kHalf.x, kHalf.y);
    vec2 kp = (px - vec2(kn.x, rect.y)) / max(vec2(0.01), vec2(kn.y, kn.z));
    float kd = sdRoundedBox(kp, kHalf, kR);
    float dThumbShad = max(0.0, sdRoundedBox(kp - vec2(0.0, 1.8), max(vec2(1.0), kHalf - 1.5), max(1.0, kR - 1.5)));
    float kShad = exp(-(dThumbShad * dThumbShad) / (2.0 * 3.0 * 3.0)) * 0.12 * st.w;
    color *= (1.0 - kShad);
    float kCov = (1.0 - smoothstep(-aa, aa, kd)) * st.w;
    vec3 thumbCol = vec3(1.0);
    float edgeHighlight = 1.0 - smoothstep(0.0, 1.15, abs(kd));
    thumbCol = mix(thumbCol, vec3(15.0, 20.0, 32.0) / 255.0, edgeHighlight * 0.11);
    color = mix(color, thumbCol, kCov);
  }

  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferPx;
  vec2 px = vec2(uv.x * uViewportCss.x, (1.0 - uv.y) * uViewportCss.y);

  vec3 color = texture(uSceneTex, uv).rgb;

  for (int g = 1; g <= 3; g++) {
    bool groupHasNodes = false;
    bool groupApplyScrim = false;
    for (int i = 0; i < MAX_SURFACES; i++) {
      if (i >= uSurfaceCount) break;
      if (int(uSurfMeta[i].x + 0.5) == 1 && int(uSurfMeta[i].z + 0.5) == g) {
        groupHasNodes = true;
        if (uSurfState[i].z > 0.5) groupApplyScrim = true;
      }
    }
    if (!groupHasNodes) continue;

    float maxR = 24.0;
    float d = evalMorphGroupSdf(g, px, maxR);
    if (d < 42.0) {
      float dummy = 0.0;
      float dContact = evalMorphGroupSdf(g, px - vec2(0.0, 1.5), dummy);
      float dAmbient = evalMorphGroupSdf(g, px - vec2(0.0, 6.0), dummy);
      float gradMag = 1.0;
      vec2 grad = d < 2.0 ? evalMorphGroupGrad(g, px, gradMag) : vec2(0.0, -1.0);
      color = shadeGlassField(color, px, d, dContact, dAmbient, grad, gradMag, maxR, groupApplyScrim, g, true);
    }
  }

  for (int i = 0; i < MAX_SURFACES; i++) {
    if (i >= uSurfaceCount) break;
    int kind = int(uSurfMeta[i].x + 0.5);
    vec4 r = uSurfRect[i];
    if (r.z <= 2.0 || r.w <= 2.0) continue;

    if (kind == 1) {
      if (int(uSurfMeta[i].z + 0.5) > 0) continue;
      vec2 lp = px - r.xy;
      vec2 halfS = r.zw * 0.5;
      float rad = uSurfMeta[i].y;
      float d = sdRoundedBox(lp, halfS, rad);
      if (d < 42.0) {
        float dContact = sdRoundedBox(lp - vec2(0.0, 1.5), halfS, rad);
        float dAmbient = sdRoundedBox(lp - vec2(0.0, 6.0), halfS, rad);
        vec2 grad = d < 2.0 ? sdGrad(lp, halfS, rad) : vec2(0.0, -1.0);
        color = shadeGlassField(color, px, d, dContact, dAmbient, grad, 1.0, rad, uSurfState[i].z > 0.5, i, false);
      }
    } else if (kind == 2) {
      color = shadeSwitchTrack(color, px, i);
    } else if (kind == 3) {
      color = shadeSliderTrack(color, px, i);
    }
  }

  vec4 chrome = texture(uChromeTex, uv);
  color = color * (1.0 - chrome.a) + chrome.rgb;

  fragColor = vec4(color, 1.0);
}
`;

export const FRAG_HIC_LOUPE = /* glsl */ `#version 300 es
precision highp float;

const int MAX_LOUPES = ${MAX_HIC_LOUPES};

uniform vec2 uViewportCss;
uniform vec2 uBufferPx;
uniform float uDpr;
uniform sampler2D uBarFbo;

uniform int uLoupeCount;
uniform vec4 uLoupeGeom[MAX_LOUPES];   // (cx, cy, nativeW, nativeH)
uniform vec4 uLoupeAnim[MAX_LOUPES];   // (scaleX, scaleY, alpha, pressGain)
uniform vec4 uLoupeOptics[MAX_LOUPES]; // (bezel, thickness, dispersionScale, tintAlpha)
uniform vec4 uLoupeExtra[MAX_LOUPES];  // (ringAlpha, touchX, touchY, touchGlow)
uniform float uLoupeTouchR[MAX_LOUPES];

uniform vec4 uGlobalLoupe; // (ior, minJacobian, strength, baseDispersion)
uniform int uProfile;
uniform vec3 uBodyColor;
uniform vec4 uLightGeom;    // (angleRad, lift, exponent, backBounce)
uniform vec4 uHiColor;
uniform vec4 uShadeColor;
uniform vec3 uRingColor;
uniform int uFgDark;

out vec4 fragColor;

${GLSL_SHARED_OPTICS}

vec3 shadeRefractingLoupe(vec3 baseCol, vec2 px, int i) {
  vec4 anim = uLoupeAnim[i];
  float alpha = anim.z;
  if (alpha <= 0.004) return baseCol;

  vec4 geom = uLoupeGeom[i];
  vec4 opt = uLoupeOptics[i];
  vec4 ext = uLoupeExtra[i];

  vec2 lp = (px - geom.xy) / max(vec2(0.01), anim.xy);
  vec2 halfBox = geom.zw * 0.5;
  float R = min(halfBox.x, halfBox.y);
  float ld = sdRoundedBox(lp, halfBox, R);
  if (ld > 36.0) return baseCol;

  // Polarity-independent sheer Gaussian shadow tucked beneath lifted droplet
  vec3 outCol = applyGlassElevationShadow(baseCol, lp, halfBox, R, 0.12 * alpha, 5.0, 8.5);

  float aa = max(0.5, 0.7 / max(1.0, uDpr));
  float cov = (1.0 - smoothstep(-aa, aa, ld)) * alpha;
  if (cov <= 0.001) return outCol;

  float s = max(0.0, -ld);
  float effBezel = min(opt.x, R);
  vec2 grad = sdGrad(lp, halfBox, R);
  float dispersion = uGlobalLoupe.w * opt.z;
  float strength = uGlobalLoupe.z;

  vec3 refr;
  if (s >= effBezel || strength <= 0.001) {
    refr = baseCol;
  } else {
    refr = sampleCauchyRefraction(
      uBarFbo,
      px,
      uViewportCss,
      grad,
      uProfile,
      s,
      effBezel,
      opt.y,
      uGlobalLoupe.x,
      strength * anim.w,
      uGlobalLoupe.y,
      dispersion,
      0.0
    );
  }

  float luma = dot(refr, vec3(0.2126, 0.7152, 0.0722));
  refr = clamp(mix(vec3(luma), refr, 1.03) * 1.03, 0.0, 1.0);

  if (opt.w > 0.001) {
    float h = opt.y * profileH(uProfile, s / max(0.001, effBezel));
    float sigma = -log(1.0 - clamp(opt.w, 0.0, 0.9)) / max(0.001, opt.y);
    float bodyA = 1.0 - exp(-sigma * h);
    refr = mix(refr, uBodyColor, bodyA);
  }

  vec2 fres = bezelDualFresnel(
    uProfile,
    s,
    grad,
    effBezel,
    opt.y,
    uGlobalLoupe.x,
    uLightGeom.x,
    uLightGeom.y,
    uLightGeom.z,
    uLightGeom.w,
    1.0 / max(1.0, uDpr)
  );

  if (ext.w > 0.003) {
    refr = applyTouchIllumination(refr, px, ext.yz, ext.w, uLoupeTouchR[i], fres.x, uFgDark);
  }

  vec3 specTint = mix(uHiColor.rgb, uHiColor.rgb * vec3(0.95, 0.99, 1.05), clamp(dispersion, 0.0, 1.0) * 0.5);
  float hiA = fres.x * uHiColor.a;
  float shA = fres.y * uShadeColor.a * (1.0 - hiA);
  refr = mix(refr, uShadeColor.rgb, shA);
  refr = mix(refr, clamp(specTint, 0.0, 1.0), hiA);

  if (ext.x > 0.004) {
    float ringBand = 1.0 - smoothstep(0.0, 1.15, abs(ld));
    refr = mix(refr, uRingColor, ringBand * ext.x);
  }

  return mix(outCol, refr, cov);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferPx;
  vec2 px = vec2(uv.x * uViewportCss.x, (1.0 - uv.y) * uViewportCss.y);

  vec3 color = texture(uBarFbo, uv).rgb;

  for (int i = 0; i < MAX_LOUPES; i++) {
    if (i >= uLoupeCount) break;
    color = shadeRefractingLoupe(color, px, i);
  }

  fragColor = vec4(color, 1.0);
}
`;
