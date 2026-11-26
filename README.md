# liquid-glass-web

> Physically grounded **Apple iOS 26/27 Liquid Glass** material and interactive component system for the web.

`liquid-glass-web` is not a `backdrop-filter: blur()` approximation or a single-browser demo. It combines real `h(0) = 0` Snell refraction, 11-band continuous Cauchy dispersion, 3D bezel-normal dual-bounce Schlick Fresnel, Beer–Lambert volumetric absorption, `GlassContainer` smooth-min (`smin`) liquid meniscus fusion, Apple SwiftUI `Spring(duration:bounce:)` physics, and live scroll-adaptive WCAG AA contrast across a 4-tier progressive enhancement pipeline.

---

## Tri-Channel Adoption

1. **npm Library (`packages/liquid-glass-web`):** Tree-shakeable React primitives (`liquid-glass-web`), zero-DOM pure physics math (`liquid-glass-web/core`), and scoped CSS (`liquid-glass-web/styles.css`).
2. **Editorial Showcase & DialKit Material Lab (`apps/web`):** Live scrollable UI demos (`/`) and an interactive optical playground (`/lab`) powered by **DialKit** with one-click **Copy JSX & Props** export.
3. **Installable Agent Skill (`skills/liquid-glass-web/SKILL.md`):** Teaches coding agents (Claude Code, Cursor, Codex, Antigravity) the exact public API, semantic presets, `smin` fusion rules, and accessibility guardrails.

---

## Quick Start

```bash
npm install liquid-glass-web motion
# or
pnpm add liquid-glass-web motion
```

```tsx
import {
  GlassStage,
  GlassContainer,
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
} from "liquid-glass-web";
import "liquid-glass-web/styles.css";

export function NavigationShell() {
  return (
    <GlassStage engine="auto">
      <YourScrollablePageContent />

      <GlassStage.Chrome>
        <GlassContainer id="nav" mergeRadius={22}>
          <GlassTabBar
            variant="regular"       // "regular" | "clear" | "tinted"
            interactive             // .interactive() touch sheen & press compression
            adaptiveContrast        // automatic >= 4.5:1 WCAG AA polarity & scrim
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

For SSR frameworks (Next.js App Router, Remix), stamp Chromium's Tier 1 capability attribute before first paint in `<head>`:

```tsx
import { CHROMIUM_REFRACT_INIT_SCRIPT } from "liquid-glass-web";

<script dangerouslySetInnerHTML={{ __html: CHROMIUM_REFRACT_INIT_SCRIPT }} />
```

---

## Semantic Material Presets

| Variant | Profile | Bezel / Thickness | Frost | Body Opacity | Best For |
| --- | --- | --- | --- | --- | --- |
| `regular` *(default)* | `circle` (`minJ ≈ 0.36`) | `16 px / 22 px` | `1.4 px` | `0.18` | Mixed scrolling UI, floating nav bars, toolbars |
| `clear` | `circle` | `16 px / 22 px` | `0.8 px` | `0.06` | Dark scenes, vivid photography, video overlays |
| `tinted` | `circle` | `16 px / 22 px` | `6.0 px` | `0.45` | Dense daylight typography and light editorial feeds |

All everyday props (`variant`, `shapeProfile`, `refraction`, `dispersion`, `frost`, `interactive`, `adaptiveContrast`, `engine`) map onto validated optical physics, with an `optics={{ ... }}` escape hatch for custom art direction.

---

## 4-Tier Progressive Enhancement Matrix

| Tier | Engine Value | Browser Target | Optical Pipeline |
| --- | --- | --- | --- |
| **Tier 0** | `html-in-canvas` | Chrome 157+ (`<canvas content="drawable" layoutsubtree>`) | WebGL2 Float32, 11-band Cauchy `n(λ)`, `polySmin` meniscus fusion + saddle damping, 4× Fresnel, `.interactive()` touch glow, `0 ms` PNG bakes |
| **Tier 1** | `svg-backdrop` | Chromium (`backdrop-filter: url(#…)`) | 1-tap linear `feDisplacementMap` GPU fast-path (100+ FPS) + seam-free opaque-piece Fresnel & Beer–Lambert luminance masks |
| **Tier 2** | `svg-content` | Safari & Firefox (`filter: url(#…-cN)`) | Aave content-path 5-band continuous spectral dispersion (`0/255` white/grey drift) + Safari cache-busting IDs + 1:1 luminance cutout mask |
| **Tier 3** | `frost` | Reduced transparency / High contrast / Forced colors | Accessible high-contrast opaque DOM surfaces honoring all 4 media queries |

---

## Accessibility by Construction

- **Real interactive HTML & ARIA APG roles:** `tablist` + roving `tabindex` (`GlassTabBar`), `role="switch"` with non-color `|`/`○` markers (`GlassSwitch`), `role="slider"` with full arrow/Page/Home/End keys (`GlassSlider`), `≥ 44×44 px` touch targets throughout.
- **Scroll-adaptive WCAG AA (`≥ 4.5:1`):** Separates 10-point area-weighted polarity sampling (Schmitt trigger `[0.24, 0.56]` with `220 ms` temporal dwell) from worst-case contrast sampling to solve minimal seamless full-capsule scrims with zero white-flash chatter.
- **All 4 preference media queries honored:** `prefers-reduced-motion: reduce`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors: active`.

---

## Workspace Development & Verification

```bash
pnpm install
pnpm test            # Deterministic Node physics, legibility, spring & CSS contract tests
pnpm typecheck       # Strict TypeScript checks across packages/* and apps/*
pnpm lint            # ESLint (--max-warnings 0)
pnpm build           # tsup (ESM + CJS + d.ts + styles.css) & Next.js production build
pnpm publint         # Strict npm exports & packaging validation
pnpm dev             # Launch interactive Showcase (/) and DialKit Material Lab (/lab)
```

Headless installed-Chrome multi-DPR (`1×`, `1.25×`, `1.5×`, `2×`) optical verification:

```bash
CHANNEL=chrome node scripts/verify-visuals.mjs
```

See [docs/architecture.md](docs/architecture.md) and [docs/verification.md](docs/verification.md) for deep technical details and measured numbers.

---

## Credits & Inspirations

- **[DialKit](https://dialkit.dev)** by **[Josh Puckett](https://github.com/joshpuckett/dialkit)** — live parameter tuning panel powering the interactive Material Lab (`/lab`).
- **Apple Human Interface Guidelines / WWDC 2025 Liquid Glass** — optical material language, `GlassEffectContainer` liquid meniscus merging, `.interactive()` touch illumination, and `Spring(duration:bounce:)` fluid motion.
- **Aave** — cross-browser SVG `filter: url()` content-path refraction technique adapted for Tier 2 Safari/Firefox fallback.

## License

MIT
