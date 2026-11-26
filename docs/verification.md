# Verification Report — `liquid-glass-web`

Recorded against production builds (`packages/liquid-glass-web` via `tsup` + `apps/web` via Next.js 16.4.6 Turbopack) on `2026-11-26`.

## 1. Automated Static & Unit Verification Gates

| Check | Command | Result |
| --- | --- | --- |
| ESLint (`--max-warnings 0`) | `pnpm lint` | **Pass** — `0` errors, `0` warnings across packages, web app, tests, and scripts |
| TypeScript (`strict: true`) | `pnpm typecheck` | **Pass** — `0` errors across `packages/liquid-glass-web` and `apps/web` |
| Deterministic Core & CSS Tests | `pnpm test` | **17 / 17 pass** (`node:test`, `1.12 s`) |
| Library Bundle (ESM + CJS + d.ts + d.cts + CSS) | `pnpm build:pkg` | **Pass** — `dist/index.js` (`"use client"` preserved), `dist/index.cjs`, `dist/core/index.{js,cjs}`, `.d.ts` / `.d.cts`, `dist/styles.css` |
| Package Exports & Packaging Lint | `pnpm publint` | **All good!** (`publint --strict`, `0` errors, `0` warnings) |
| Web Showcase + DialKit Lab Build | `pnpm build:web` | **Pass** — static prerender of `/`, `/lab`, `/icon.svg`, `/_not-found` |

### Unit Test Coverage (`packages/liquid-glass-web/tests/`)
- `optics.test.mjs`: Snell physical table (`circle` & `c2squircle`, `h(0) = 0`), boundary continuity `d(0) = d(b) = 0` for all variants (`regular`, `clear`, `tinted`), worst-case Blue-channel press fold-free guard (`minJ >= 0.20`, `b <= R`), exact neutral `128` tile center & lossless quadrant mirroring (`256 - byte`), 3D bezel-normal dual-bounce Fresnel smooth decay across `1×–3×` DPR (zero wireframe `ambientRim`), 5-band spectral sum `(1, 1, 1)`, Aave premultiplied RGB + parallel coverage alpha safety (`#ffffff`, AA strokes, `A = 0`), fractional DPR seam-free overlay invariants (`cut <= 2`, `pad > 1` across `1×`, `1.25×`, `1.5×`, `1.75×`, `2×`, `3×`), and Tier 0 11-band Cauchy `n(λ)` weights & monotonicity.
- `legibility.test.mjs`: Scroll-adaptive WCAG AA `>= 4.5:1` (`>= 4.8:1` headroom) across 8 light/dark/coral/gold/checkerboard scenes, gold plasma crest & 2-of-10 card-gap anti-flash regressions, and `220 ms` temporal polarity dwell stability.
- `motion-smin.test.mjs`: SwiftUI `Spring(duration:bounce:)` analytical damping ratios with strict assertion that `"duration" in spring === false && "bounce" in spring === false` (preventing `motion/react`'s 50 ms snap trap), size-proportional deformation (`< 10%` ceiling), hyperbolic rubber-banding, momentum projection, `tapFlightBell` zeros & peak, keyboard/reduced-motion transition modes, `polySmin` exact kiss at `gap = k / 2`, and semantic variant config resolver.
- `css-contract.test.mjs`: `-webkit-backdrop-filter` before `backdrop-filter` in every rule, `border-radius: inherit` on `::before` and `::after`, no `background-color` transition on `::before`, and all 4 a11y media queries (`prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more`, `forced-colors: active`).

---

## 2. Headless Installed-Chrome Multi-DPR Optical & Performance Harness

Command: `CHANNEL=chrome node scripts/verify-visuals.mjs` against `next start` (`127.0.0.1:3101`).
Browser: Installed Chrome **`158.0.8127.38`** (headless, `1×`, `1.25×`, `1.5×`, and `2×` DPR).

| Gate / Metric | Threshold | Measured Result | Status |
| --- | --- | --- | --- |
| Console & page errors (all routes & DPRs) | `0` | **`0`** | Pass |
| Showcase (`/`) live Tier 0 detection + full kit | Tier 0 + 5 components | `html-in-canvas` · TabBar, Orb, Switch, Slider, Button | Pass |
| Material Lab (`/lab`) DialKit + Attribution + JSX Drawer | DialKit + Josh Puckett + `<GlassStage` | Panel mounted, attribution visible, DialKit action button opens JSX drawer | Pass |
| Tier 0 `smin` liquid fusion neck (`02-tier0-hic-smin-2x.png`) | `fusedGapPx = 3`, zero center pinch dot | `fusedGapPx: 3 px`, `saddleCenterDeltaLuma: 0.1` | Pass |
| Tier 1 center text purity (`18,720` channels vs `scale = 0`) | `max === 0` | **`max: 0`, `mean: 0`, `over2: 0`** | Pass |
| Tier 1 white (`#ffffff`) & mid-grey (`#808080`) accuracy | `0 / 255` error | **`0 / 0`** (`[255,255,255]`, `[128,128,128]`) | Pass |
| Tier 1 outer-edge RGB spread (top / bottom `0..6 px`) | `<= 18` | **`16 / 17`** | Pass |
| Tier 1 2× ruler bend / straight shear / sliver runs (Bar) | `bow > 1`, `shear <= 0.5`, `runs === 1` | **`2.01 px` / `0.00 px` / `1 run`** | Pass |
| Tier 1 2× ruler bend / straight shear / sliver runs (Loupe) | `bow > 1`, `shear <= 0.5`, `runs === 1` | **`5.99 px` / `0.00 px` / `1 run`** | Pass |
| PNG tile bakes during press → drag → release gesture | `0` | **`0`** | Pass |
| Tier 1 tab-switch perf (live Plasma running) | `maxFrameMs < 100 ms`, `>= 20` visible frames | **`maxFrameMs: 20.8 ms`**, **`avgFrameMs: 6.4 ms`**, **`47` visible loupe frames** (`113` total frames) | Pass |
| Daylight Feed WCAG AA & Bar/Orb tint parity | `fg="dark"`, `>= 4.5:1`, identical `::before` tint | `fg: "dark"`, **`5.36:1` worst-case**, `bar === orb === rgb(250, 251, 254)` | Pass |
| Tier 2 Aave content-path (`06-tier2-aave-ribbon-2x.png`) | 5 spectral bands + ghost bar + cutout | `5` `feDisplacementMap` bands (`-c1` suffix), ghost bar active | Pass |

### Fractional DPR Fresnel Top-Rim Luminance Decay (`s = 0..5 CSS px`)

Every tested device pixel ratio shows monotonic inward decay from row `0` with zero wireframe spike:

| DPR | Row 0 | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `1×` | `143.7` | `53.3` | `25.1` | `10.9` | `4.2` | `1.3` |
| `1.25×` | `110.4` | `36.6` | `19.5` | `10.3` | `2.9` | `0.7` |
| `1.5×` | `104.1` | `93.0` | `31.5` | `18.9` | `6.1` | `2.8` |
| `2×` | `152.0` | `56.2` | `26.8` | `11.9` | `4.7` | `1.3` |

### Red → Green Engineering Catch During Verification
- During the initial harness run, `GlassTabBar`'s `420 ms` legibility sampling loop could collide mid-flight with a Tier 1 tab-switch spring (`45.9 ms` frame spike, `13` visible loupe frames), and `/favicon.ico` returned 404.
- Fix: skipped `getImageData` backdrop sampling while `flyingRef.current` is active during transient spring flights, destructured stable `GlassStageContext` callbacks so legibility updates do not re-register the sampling loop, and added `apps/web/src/app/icon.svg`.
- Post-fix result: `0` console/page errors, `maxFrameMs` dropped from `45.9 ms` to **`20.8 ms`** (`avgFrameMs: 6.4 ms`), and visible loupe frames jumped from `13` to **`47`**.

### Visual Inspection Summary
All 9 generated 2× screenshots (`dist/verify-visuals/00-showcase-landing-2x.png` through `07-c2squircle-grid-2x.png` plus `contact-sheet.png`) were visually inspected:
- Confirmed full-viewport hero framing on `/` with consistent dark polarity across the entire floating glass dock (`GlassTabBar`, `GlassOrb`, `GlassSwitch`, `GlassSlider`, `GlassButton`).
- Confirmed single-row Material Lab top HUD at `1440×900`, live DialKit panel, diagnostics pill, and Josh Puckett attribution.
- Confirmed smooth Tier 0 `smin` liquid meniscus neck with zero center pinch dot, clean Tier 1 plasma refraction, exact bar/orb tint parity on Daylight Feed, 5-band continuous chromatic prism dispersion in Tier 2 Aave Ribbon, and fold-free vertical chromatic bar bending in C² Squircle Optics Grid.

---

## 3. Unverified Platforms & Known Limits

The following real-hardware / cross-engine environments were **not** directly tested on this Windows verification host and remain to be verified on target hardware before publishing `1.0.0`:
- **Native macOS / iOS Safari (WebKit):** Verified structurally via Tier 2 Aave content-path (`filter: url(#…-cN)`) + CSS `mask-mode: luminance` unit and Chrome-simulated checks, but not rendered on live Apple WebKit hardware.
- **Native Firefox (Gecko):** Takes Tier 2 Aave content-path + CSS `mask-mode: luminance`; not executed on live Firefox on this host.
- **Physical touch hardware & real VoiceOver / TalkBack:** Pointer Events (`setPointerCapture`), `≥ 44×44 px` touch targets, ARIA APG roles (`tablist`, `switch`, `slider`), and keyboard navigation were verified in headless Chromium, not on physical iOS/Android touchscreens or native screen readers.
- **Tier 0 browser requirement:** Native HTML-in-Canvas WebGL2 (`<canvas content="drawable" layoutsubtree>`) requires Chrome 157+; earlier Chromium versions automatically negotiate Tier 1 (`svg-backdrop`), and Safari/Firefox automatically negotiate Tier 2 (`svg-content`).
