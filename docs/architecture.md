# Architecture — `liquid-glass-web`

## Monorepo Layout

```text
liquid-glass-web/
├── packages/liquid-glass-web/
│   ├── src/
│   │   ├── core/          # Zero-DOM pure math (color, sdf, overlay, optics, legibility, motion, hicShaders, presets)
│   │   ├── engines/       # Tier 0 HIC WebGL2 (webgl, hicBridge, HicStage), Tier 1/2 useLiquidGlass, backdropSampler, capabilities
│   │   ├── primitives/    # GlassStage (+ Chrome slot), GlassContainer (smin group), GlassSurface, context
│   │   ├── components/    # GlassTabBar, GlassOrb, GlassSwitch, GlassSlider, GlassButton
│   │   └── styles/        # Scoped .lgw-* stylesheet (copied to dist/styles.css)
│   └── tests/             # Deterministic node:test verification suites
├── apps/web/              # Next.js editorial showcase (/) + DialKit Material Lab (/lab)
├── skills/liquid-glass-web/
│   ├── SKILL.md           # Installable Agent Skill
│   └── references/        # Deep optical & browser pitfall reference
├── scripts/
│   └── verify-visuals.mjs # Headless installed-Chrome 1x/1.25x/1.5x/2x optical & perf harness
└── docs/
    └── architecture.md
```

## Key Subsystems

### 1. Pure Zero-DOM Core (`@pavlonekrasov/liquid-glass-web/core`)
All optical, colorimetric, geometric, and spring calculations have zero DOM or React dependencies so every physical invariant runs deterministically in Node unit tests and builds cleanly for SSR / RSC environments:
- **`optics.ts`**: Single-interface Snell refraction with strict `h(0) = 0`, fold-free Jacobian guard (`min(1 + M * d') >= 0.20`), lossless quadrant-mirrored 9-slice displacement tile generator, 3D bezel-normal dual-bounce Schlick Fresnel with `solveDisplayGain` DPR calibration (`1×–3×`), Beer–Lambert absorption, and 5-band continuous spectral weights summing to `(1, 1, 1)`.
- **`overlay.ts`**: Paints nine-slice Fresnel and Beer–Lambert fields from opaque tiles in exact overlap order (`face -> top/bottom -> side bands -> corners`) so fractional DPRs (`1.25×`, `1.5×`, `1.75×`) produce zero seam hairlines.
- **`legibility.ts`**: Separates area-weighted `polaritySamples` (Schmitt trigger `[0.24, 0.56]` + `220 ms` dwell) from worst-case `contrastSamples` (binary-searched uniform scrim alpha holding `>= 4.5:1` WCAG AA).
- **`motion.ts`**: Converts Apple SwiftUI `Spring(duration:bounce:)` into `{ type: "spring", stiffness, damping, mass: 1 }`, deliberately omitting `duration` and `bounce` keys so `motion/react` runs true harmonic oscillator physics.
- **`hicShaders.ts`**: Pure GLSL ES 3.00 generators for Tier 0 WebGL2 (`GlassNode[8]` + `GlassLoupe[4]`, 11-band Cauchy `n(λ)`, `sminPoly` with `gradMag` saddle damping, 13-tap golden-angle Poisson frost, 4× Fresnel, tucked two-layer chroma-preserving Gaussian shadows).

### 2. 4-Tier Engine Negotiation (`engines/capabilities.ts`)
`<GlassStage engine="auto">` negotiates the active rendering pipeline automatically:
1. **Tier 0 (`html-in-canvas`)**: Activates when `<canvas content="drawable" layoutsubtree>`, `getElementImageDefaultSize`, `updateElementGeometry`, and `gl.texElementSubImage2D` exist (Chrome 157+). A frame-locked mutable bus (`HicGlassBridge`) feeds 120fps spring coordinates directly into pre-allocated `Float32Array` uniform buffers with zero React re-renders and `0 ms` PNG tile bakes.
2. **Tier 1 (`svg-backdrop`)**: Activates on Chromium builds where `backdrop-filter: url(#…)` is supported (`[data-lg-refract]`). Uses a 1-tap linear `feDisplacementMap` fast-path (100+ FPS) with static scale during gestures and `-webkit-mask-box-image` SVG `<mask>` overlays.
3. **Tier 2 (`svg-content`)**: Activates on Safari and Firefox. Uses standard `filter: url(#…-cN)` with 5-band transparent-safe premultiplied RGB + parallel coverage `A_avg`, Safari cache-busting IDs, and a 1:1 SVG luminance cutout mask over the underlying track to prevent double icons.
4. **Tier 3 (`frost`)**: Activates automatically under `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, or `forced-colors: active` (or `engine="frost"`), rendering crisp high-contrast accessible DOM.

### 3. Coordinated Adaptive Polarity & `GlassContainer` Merging
`<GlassContainer id="nav" mergeRadius={22}>` assigns a shared `morphGroup` (`1..3`) to its children. `<GlassTabBar>` samples the live backdrop behind the bar and reports polarity & scrim state up to `<GlassStage>`, propagating `[data-fg]` and `[data-adaptive-a11y]` uniformly to both `<GlassTabBar>` and sibling `<GlassOrb>` / `<GlassButton>` surfaces for exact daylight/dark tint parity across every tier.
