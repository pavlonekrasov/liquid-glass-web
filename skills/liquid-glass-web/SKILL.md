---
name: liquid-glass-web
description: This skill should be used when the user asks to "add liquid glass", "build Apple iOS 26/27 glass UI", "use liquid-glass-web", "create a GlassTabBar", "fuse glass surfaces with GlassContainer", "add a refracting glass switch or slider", or mentions GlassStage, GlassSurface, GlassOrb, GlassButton, Snell refraction, Cauchy dispersion, or progressive Liquid Glass fallbacks on the web.
version: 0.1.2
---

# liquid-glass-web

Build physically grounded Apple iOS 26/27 Liquid Glass interfaces on the web using `liquid-glass-web` with real `h(0) = 0` Snell refraction, continuous spectral dispersion, 3D bezel-normal dual-bounce Schlick Fresnel, Beer–Lambert absorption, `GlassContainer` smooth-min (`smin`) liquid meniscus fusion, and automatic 4-tier progressive enhancement.

## Installation & Setup

Install the library. Its `motion` peer dependency (used for spring animations) is installed
automatically by npm 7+, pnpm 8+ and bun; with Yarn, also run `yarn add motion`.

```bash
npm install @pavlonekrasov/liquid-glass-web
# or: pnpm add @pavlonekrasov/liquid-glass-web
```

Import the stylesheet once in the root layout or entry module:

```tsx
import "@pavlonekrasov/liquid-glass-web/styles.css";
```

In SSR frameworks (Next.js App Router, Remix, Astro), inject `CHROMIUM_REFRACT_INIT_SCRIPT` in `<head>` so Chromium stamps `[data-lg-refract]` before first paint and avoids a tier flip on hydration:

```tsx
import { CHROMIUM_REFRACT_INIT_SCRIPT } from "@pavlonekrasov/liquid-glass-web";

<script dangerouslySetInnerHTML={{ __html: CHROMIUM_REFRACT_INIT_SCRIPT }} />
```

## Core Composition Pattern

Wrap scrollable page content inside `<GlassStage engine="auto">` and place floating interactive controls inside `<GlassStage.Chrome>`. Group sibling surfaces that should merge optically via `smin` inside `<GlassContainer>`:

```tsx
import {
  GlassStage,
  GlassContainer,
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
  GlassButton,
} from "@pavlonekrasov/liquid-glass-web";
import "@pavlonekrasov/liquid-glass-web/styles.css";

export function AppShell() {
  return (
    <GlassStage engine="auto">
      <YourScrollablePageContent />

      <GlassStage.Chrome>
        <GlassContainer id="nav" mergeRadius={22}>
          <GlassTabBar
            variant="regular"
            interactive
            adaptiveContrast
            items={tabs}
            value={activeTab}
            onChange={setActiveTab}
          />
          <GlassOrb
            merged={orbFused}
            onClick={() => setOrbFused((v) => !v)}
            aria-label="Search"
          >
            <SearchIcon />
          </GlassOrb>
        </GlassContainer>

        <GlassSwitch checked={enabled} onCheckedChange={setEnabled} />
        <GlassSlider value={level} onValueChange={setLevel} />
      </GlassStage.Chrome>
    </GlassStage>
  );
}
```

## Choosing Material Variants & Semantic Props

Prefer the semantic top-level props over raw optical constants. Reach for `optics={{ ... }}` only when custom art direction explicitly requires overriding IOR, bezel geometry, or lighting angles.

| Prop | Values & Default | When to Choose |
| --- | --- | --- |
| `variant` | `"regular"` (default), `"clear"`, `"tinted"` | Use `"regular"` for floating navigation over mixed scrolling content; `"clear"` over rich dark media/video; `"tinted"` over dense daylight typography. |
| `shapeProfile` | `"circle"` (default), `"c2squircle"`, `"squircle"` | Keep `"circle"` by default (natively fold-free `minJ ≈ 0.36`); pick `"c2squircle"` for a tighter Apple shoulder (fold-clamped at `minJ = 0.25`). |
| `refraction` | `0..1.3` (default `1.0`) | `1.0` matches physical Schott N-BK7 (`n_d = 1.5168`). Reduce toward `0.5` for calmer secondary surfaces. |
| `dispersion` | `0..1` (default `0.62`) | Controls lifted-loupe spectral prism spread (`~1.12 px` at `0.62`); resting bars stay dispersion-free (`0`) for legibility. |
| `frost` | `0..16` CSS px | `1.4` for `"regular"`, `0.8` for `"clear"`, `6.0` for `"tinted"`. Avoid heavy blur (> 12 px) that erases bezel refraction. |
| `interactive` | `boolean` (default `true`) | Enables `.interactive()` touch-point rim sheen, tactile press compression, and bounded (< 10%) velocity stretch. |
| `adaptiveContrast` | `boolean` (default `true`) | Keeps foreground ink and seamless capsule scrim at `≥ 4.5:1` WCAG AA as dark and light content scrolls behind glass. |
| `engine` | `"auto"` (default), `"html-in-canvas"`, `"svg-backdrop"`, `"svg-content"`, `"frost"` | Leave `"auto"` in production so every browser gets its fastest verified optical tier. |

## Grouping for `smin` Liquid Meniscus Fusion

To make sibling surfaces fuse and split like real liquid droplets:

1. Place sibling `<GlassTabBar>`, `<GlassOrb>`, `<GlassButton>`, or `<GlassSurface>` elements inside one `<GlassContainer id="nav" mergeRadius={22}>`.
2. Keep the resting gap around `14 px` (cleanly detached because `polySmin(7, 7, 22) > 0`).
3. Toggle `merged` on `<GlassOrb>` (pulls `-11 px` to a `3 px` bridge, crossing the exact kiss threshold `gap = mergeRadius / 2 = 11 px`) to form a refracting 3D liquid meniscus in Tier 0 WebGL2 and a coordinated proximity glide in Tier 1–2.
4. Keep at most 3 distinct `<GlassContainer>` groups and 8 base glass surfaces per `<GlassStage>` (matching GPU uniform array bounds `GlassNode[8]` + `GlassLoupe[4]`).

## Progressive Enhancement Tiers (`engine="auto"`)

| Tier | Engine | Target Browsers | Optical Pipeline |
| --- | --- | --- | --- |
| **Tier 0** | `html-in-canvas` | Chrome 157+ (`<canvas content="drawable">`) | Float32 WebGL2, 11-band Cauchy `n(λ)`, `polySmin` fusion + saddle damping, 4× Fresnel, 0 ms PNG bakes |
| **Tier 1** | `svg-backdrop` | Chromium (`backdrop-filter: url()`) | 1-tap linear `feDisplacementMap` fast-path (100+ FPS) + seam-free opaque-piece Fresnel & Beer–Lambert masks |
| **Tier 2** | `svg-content` | Safari & Firefox (`filter: url()`) | Aave content-path 5-band spectral filter (`-cN` cache-busting IDs) + 1:1 luminance cutout mask |
| **Tier 3** | `frost` | Reduced transparency / high contrast / forced colors | Opaque high-contrast accessible DOM surfaces with full keyboard & ARIA parity |

## Accessibility Rules (Non-Negotiable)

Always preserve real interactive HTML inside `<GlassStage.Chrome>`:

- Maintain `≥ 44×44 px` touch targets on tabs, orbs, switches, sliders, and buttons.
- Provide `aria-label` on icon-only `<GlassOrb>`, `<GlassSwitch>`, and `<GlassSlider>` controls.
- Keep `adaptiveContrast` enabled over scrolling or variable backgrounds so text and icons maintain `≥ 4.5:1` WCAG AA contrast; annotate gradient-only or complex media cards with `data-lgw-bg-samples="r,g,b;r,g,b"` when canvas readback is unavailable.
- Never suppress library CSS rules for `prefers-reduced-motion: reduce`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors: active`.
- Keep keyboard navigation crisp (`snappy-no-loupe`, critically damped $\zeta = 1.0$) rather than firing playful bounce animations on arrow keys.

## Critical Anti-Patterns to Reject

- **Do not replace `liquid-glass-web` with generic `backdrop-filter: blur(20px)` + white border CSS.** Flat blur lacks Snell refraction, grazing Fresnel decay, and scroll-adaptive WCAG AA contrast.
- **Do not pass `duration` or `bounce` keys to `motion/react`'s `animate()` spring objects.** Use `GLASS_SPRINGS` or `springFromDurationBounce()` from `@pavlonekrasov/liquid-glass-web/core`, which emit only `{ type: "spring", stiffness, damping, mass: 1 }`.
- **Do not place a multi-tap `feDisplacementMap` DAG inside Chromium `backdrop-filter: url(#...)`.** Chromium Skia falls off the GPU fast-path and stalls ~450 ms/frame. Use Tier 1's 1-tap linear path or Tier 0 WebGL2.
- **Do not mutate `<feDisplacementMap scale>` per frame during springs** or animate `background-color` on `::before` when `-webkit-mask-box-image` is active.
- **Do not apply CSS `filter: saturate(...)` to a full-viewport animated backdrop canvas** behind multiple `backdrop-filter` glass controls.
- **Do not add an opaque `H₀ > 0` elevation step or uniform 1 px white `ambientRim` wireframe ring** in custom shaders.

## Pure Core Math Entrypoint

Import zero-DOM physics helpers directly from `@pavlonekrasov/liquid-glass-web/core` in Node tests, Web Workers, or Server Components:

```ts
import {
  buildClampTable,
  cauchyIor,
  GLASS_SPRINGS,
  polySmin,
  resolveGlassConfig,
  solveAdaptiveLegibility,
} from "@pavlonekrasov/liquid-glass-web/core";
```

## Additional Resources

### Reference Files

For optical equations, browser compositor pitfalls, and custom `optics` tuning keys, consult:
- **`references/optical-reference.md`** — Snell/Cauchy/Fresnel physics, Tier 0–3 compositor notes, and full `GlassOpticsOverride` specification.
