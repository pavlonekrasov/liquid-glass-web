# liquid-glass-web Optical & Compositor Reference

Detailed physical laws, browser compositor invariants, and advanced `optics` override reference for `liquid-glass-web`.

## 1. Physical Laws Enforced by `liquid-glass-web/core`

### Strict `h(0) = 0` Boundary Continuity
- Every height profile `f(x)` (`circle`, `c2squircle`, `squircle`) satisfies `f(0) = 0`, `f(1) = 1`, and `f'(1) = 0`.
- Single-interface Snell lateral displacement `d(s) = h(s) * tan(theta1 - theta2)` equals exactly `0` at both `s = 0` (outer edge) and `s = b` (inner bezel boundary).
- Adding a non-zero elevation step `H0 > 0` breaks boundary continuity and teleports exterior background pixels into neon edge fringes.

### Fold-Free Jacobian Guard
- For a displacement field scaled by worst-case multiplier `M_max = max(1, strength) * pressGain * blueBandFactor`, the sampling Jacobian is `J(s) = 1 + M_max * d'(s)`.
- `buildClampTable()` integrates backward from `s = b` whenever `rawMinJacobian < minJacobian`, guaranteeing `min(1 + M_max * d'(s)) >= 0.20` and `b <= R`.
- Default `circle` at `b = 16, T = 22, n_d = 1.5168` is natively fold-free (`dMax = 6.45 px`, `minJ ≈ 0.36`). `c2squircle` is fold-clamped cleanly at `minJ = 0.25`.

### Spectral Dispersion
- **Tier 0 (WebGL2 HTML-in-Canvas):** 11 continuous wavelengths (`656 nm` H-alpha C-line to `435 nm` Hg g-line) driven by exact Cauchy dispersion `n(lambda) = n_d + B * (1/lambda^2 - 1/lambda_d^2)`, `lambda_d = 0.5876 um`, `MAX_CAUCHY_B = 0.06`. Channel weights sum to exact `(1.00, 1.00, 1.00)`.
- **Tier 2 (Aave Content-Path):** 5 continuous bands (`r`, `y`, `g`, `c`, `b`) summing to `(1.00, 1.00, 1.00)` with `mA = 1` premultiplied RGB accumulation and parallel `A_avg = sum(0.2 * alpha_i)` coverage recombination via `rgbOpaque - (1 - A_avg)`.
- **Tier 1 (Chromium SVG Backdrop):** Deliberately linear 1-tap `feDisplacementMap` (achromatic) to stay on Chromium Skia's 100+ FPS GPU fast-path.

### 3D Bezel-Normal Dual-Bounce Schlick Fresnel
- Normal `N(s) = (p * grad, q)` where `p = m / sqrt(m^2 + 1)`, `q = 1 / sqrt(m^2 + 1)`, `m = h'(s)`.
- Box-filtered across device pixel ratios `1x–3x` (`solveDisplayGain` calibrates first-CSS-pixel exposure so row 0 peak luminance matches across DPRs with monotonic inward decay and zero uniform wireframe ring).
- Includes primary studio key lobe `L1` and opposite-side internal bounce lobe `L2`.

### Polynomial Smooth-Minimum (`smin`) & Saddle Damping
- `polySmin(a, b, k) = min(a, b) - h^2 * k * 0.25` where `h = max(k - |a - b|, 0) / k`.
- Two shapes separated by gap `g` kiss at `g = k / 2` (`11 px` for default `k = 22 px`), supporting both full capsules and custom-radius rounded rectangles (`r < hh`).
- In Tier 0 WebGL2, `gradMag = clamp(length(vec2(gx, gy)) / (2 * eps), 0, 1)` damps Snell strength and Fresnel by `smoothstep(0.05, 0.85, gradMag)` across concave bridge saddles to eliminate center pinch dots.
- In Tier 1–2 `<GlassContainer>`, `unionWebgl.ts` renders the unified contour at full `sheetScale(dpr)` on every 120 Hz spring frame (~0.15 ms) using the shared `65 × 65` `dualRimTerms` LUT, exact Gaussian half-plane outer shadow convolution strictly on `1 - coverage`, exact CSS stacking order (`1px border` → `::before` body tint → `.lgw-scrim` → `::after` 3D Fresnel on top), and a synchronous inline DOM `<svg><mask>` with zero-bake translating Snell tiles during motion (upgrading to the unified `2×` saddle displacement map `65 ms` after settle).

### Two-Layer Tucked Gaussian Shadow
- Chroma-preserving shadow law: `pow(bg, 1 + 0.32s) * (1 - 0.88s)`.
- Combines inset contact (`+2 px`, `sigma = 2.8`) and inset ambient (`+6 px`, `sigma = 10.0` on bars, `8.5` polarity-independent `0.12` on lifted loupes).

## 2. Browser & Compositor Pitfalls

| Tier / Subsystem | Pitfall | Enforced Safeguard |
| --- | --- | --- |
| Tier 0 HIC | Calling `getElementImageDefaultSize()` outside `canvas.onpaint` throws `InvalidStateError` | Invoked strictly inside `canvas.onpaint` |
| Tier 0 HIC | Unpremultiplied chrome halos or inverted Y | `sceneEl`: `FLIP_Y=1, PREMULTIPLY=0`; `chromeEl`: `FLIP_Y=1, PREMULTIPLY=1`, composite `color*(1-chrome.a)+chrome.rgb` |
| Tier 0 HIC | Retina `texElementSubImage2D` starving 120fps springs | Continuous animated scene `requestPaint()` throttled to `>= 32 ms` (~30 Hz) |
| Tier 0 HIC | Pass 1 + Pass 2 `.interactive()` touch glow compounding into milky haze | Attenuate base surface glow by `1 - loupeOpacity * 0.85`; keep interior sheen `0.045–0.07` |
| Tier 1 SVG | Multi-tap `feDisplacementMap` inside `backdrop-filter: url()` stalls ~450 ms/frame | Linear 1-tap `feDisplacementMap` fast-path only in Tier 1 |
| Tier 1 SVG | Mutating `feDisplacementMap[scale]` per frame rebuilds Skia DAG | Static SVG `scale` during springs; animate GPU `transform` & `opacity` only |
| Tier 1 SVG | Animating `background-color` on `::before` with `-webkit-mask-box-image` flashes solid white | Animate `opacity` on dedicated `.lgw-scrim` element only |
| Tier 1–2 Union | `data:image/svg+xml` `mask-image` lags 1–2 frames behind motion & `destination-out` shadows leave a dark AA fringe | Use synchronous inline DOM `<svg><mask id="...">` and pure analytical Gaussian half-plane SDF outer shadow inside full-DPR WebGL2 (`unionWebgl.ts`) |
| Tier 1–2 Union | Compositing 1 px outer border over Fresnel darkens Paper top rims by ~27 luma | Match exact W3C CSS stacking order inside `isolation: isolate`: `1px border` → body tint → scrim → 3D Fresnel on top |
| Tier 1–2 Input | `.lgw-chrome .lgw-glass-surface { pointer-events: auto }` overriding `.lgw-loupe { pointer-events: none }` swallows active-tab drag events | Exclude `:not(.lgw-loupe):not(.lgw-switch__loupe):not(.lgw-slider__loupe)` on `.lgw-chrome` |
| Tier 2 Aave | Safari SVG filter cache stale on resize & double icons under loupe | Bump `-cN` filter ID suffix on geometry updates + measured 1:1 SVG luminance cutout mask on track |
| Motion | Passing `duration` or `bounce` keys to `motion/react` `animate()` collapses springs to ~50 ms snap | `springFromDurationBounce()` emits `{ type: "spring", stiffness, damping, mass: 1 }` only |

## 3. Full `GlassOpticsOverride` Keys

Pass via `optics={{ ... }}` on `<GlassStage>`, `<GlassSurface>`, `<GlassTabBar>`, `<GlassOrb>`, `<GlassSwitch>`, `<GlassSlider>`, or `<GlassButton>`:

| Key | Type | Default (`regular`) | Notes |
| --- | --- | --- | --- |
| `bezel` | `number` | `16` | Outer curved bezel width in CSS px (`6..28`, clamped to `<= R`) |
| `thickness` | `number` | `22` | Plateau thickness `T` in CSS px (`8..40`) |
| `ior` | `number` | `1.5168` | Refractive index `n_d` (`1.15..1.85`, Schott N-BK7 default) |
| `minJacobian` | `number` | `0.22` | Fold-free floor (`0.20..0.55`) |
| `barDispersion` | `number` | `0` | Resting bar dispersion (`0..1`, keep `0` for crisp labels) |
| `loupeBezel` | `number` | `bezel` | Lifted droplet bezel width |
| `loupeThickness` | `number` | `thickness` | Lifted droplet plateau thickness |
| `loupeStrength` | `number` | `refraction` | Lifted droplet Snell scale |
| `tintColor` | `string \| RgbColor` | `"#0e121c"` | Beer–Lambert body absorption color. Any CSS color works: hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color(display-p3 …)` and other `color()` spaces, named colors, and `var()` in the browser. Wide-gamut colors are gamut mapped to sRGB (CSS Color 4); the color's alpha multiplies `bodyOpacity`. Overridden by `adaptiveContrast` when enabled |
| `bodyOpacity` | `number` | `0.18` | Beer–Lambert plateau absorption (`0..0.85`) |
| `rimAlphaMin` | `number` | `0.02` | Minimum rim tint floor (`0..0.5`) |
| `saturate` | `number` | `1.28` | Saturation boost of what is seen through the glass (`0.5..2`) |
| `brightness` | `number` | `1.02` | Brightness of what is seen through the glass (`0.6..1.4`) |
| `contrast` | `number` | `1.02` | Contrast of what is seen through the glass (`0.6..1.4`) |
| `shadeAlpha` | `number` | `0.14` | Strength of the shaded side of the rim, opposite the key light (`0..0.5`) |
| `lightAngle` | `number` | `-125` | Key light screen azimuth in degrees |
| `lightLift` | `number` | `0.55` | Key light elevation |
| `lightExponent` | `number` | `2.2` | Specular focus exponent |
| `specular` | `number` | `0.82` | First-CSS-px peak Fresnel highlight alpha (`0..1`) |
| `backBounce` | `number` | `0.55` | Opposite-edge internal reflection lobe (`0..1`) |
| `shadowStrength` | `number` | `0.13` | Two-layer tucked Gaussian elevation shadow (`0..0.25`) |
| `edgeRingAlpha` | `number` | `0.14` | Low-alpha 1 px containment ring (`0..0.4`) |
| `edgeRingLight` | `boolean` | `true` | White vs dark containment ring polarity |
| `foreground` | `"light" \| "dark"` | `"light"` | Static foreground ink when `adaptiveContrast={false}` |
| `activePill` | `"refracting-loupe" \| "tint" \| "ink"` | `"refracting-loupe"` | Active tab indicator style |
| `pressCompression` | `boolean` | `true` | Enables `1.12x` optical press compression |
