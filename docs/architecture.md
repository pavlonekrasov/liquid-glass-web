# How `liquid-glass-web` is built

A short tour of the code, for anyone who wants to contribute or is curious how the glass works.

## Folder layout

```text
liquid-glass-web/
├── packages/liquid-glass-web/
│   ├── src/
│   │   ├── core/          # The math: light, color, shapes, readability and springs (no React, no DOM)
│   │   ├── engines/       # The different ways of drawing the glass, and picking one per browser
│   │   ├── primitives/    # The building blocks: GlassStage, GlassContainer, GlassSurface
│   │   ├── components/    # Ready-made controls: GlassTabBar, GlassOrb, GlassSwitch, GlassSlider, GlassButton, GlassScrollEdge
│   │   └── styles/        # The stylesheet, shipped as styles.css
│   └── tests/             # Unit tests that run in Node
├── apps/web/              # The demo site (/) and Material Lab (/lab)
├── skills/liquid-glass-web/
│   ├── SKILL.md           # The Agent Skill for coding agents
│   └── references/        # Extra detail the skill can look up
├── scripts/
│   ├── verify-visuals.mjs # Screenshot checks in Chrome at several screen densities
│   └── verify-firefox.mjs # The same kind of checks in Firefox
└── docs/
    └── architecture.md    # This file
```

## The math (`core/`)

Everything that decides how the glass looks and moves lives here, as plain functions with no React or DOM. That keeps it easy to test in Node and safe to run during server rendering. It's published on its own at `@pavlonekrasov/liquid-glass-web/core`.

- **`optics.ts`**: how much the glass bends what's behind it, the rainbow edges, the highlights along the rim, and how the glass gets slightly darker where it's thicker. It also keeps the bending from folding the image over on itself, and adjusts for screen density.
- **`overlay.ts`**: draws the rim highlights and shading in nine pieces (corners, edges, middle) that fit together without hairline gaps, even on 1.25× or 1.5× screens.
- **`legibility.ts`**: keeps text on the glass readable. It checks how bright the content behind the glass is, picks light or dark text, and adds just enough backing to reach WCAG AA contrast (4.5:1). It waits briefly before switching so the text doesn't flicker while you scroll.
- **`motion.ts`**: turns Apple's spring settings (duration and bounce) into springs that [Motion](https://motion.dev) can run.
- **`hicShaders.ts`**: writes the WebGL shaders that the Chrome 157+ engine uses.

## Picking an engine (`engines/`)

`<GlassStage engine="auto">` checks what the browser supports and picks the best way to draw the glass:

1. **`html-in-canvas`** (Chrome 157+): the full effect, drawn with WebGL. Spring animations update the shader directly on every frame, without re-rendering React.
2. **`svg-backdrop`** (other Chromium browsers): bends the page behind the glass with an SVG filter. It's fast, and it stays smooth during drags.
3. **`svg-content`** (Safari and Firefox): these browsers can't filter what's behind an element, so the glass bends its own content with an SVG filter instead.
4. **`frost`**: a solid, high-contrast surface. It's used when someone has turned on reduced transparency, increased contrast or forced colors, or when you pass `engine="frost"`.

## Shapes that merge (`GlassContainer`)

Glass shapes inside the same `<GlassContainer>` act as one group. When they get within `mergeRadius` pixels of each other, they melt together into a single piece of glass, like the search button joining the tab bar in iOS. On Chrome 157+ this runs directly inside the stage's WebGL shader; on SVG tiers (`svg-backdrop` and `svg-content`) a dedicated WebGL2 union surface (`unionWebgl.ts`) and synchronous inline SVG `<mask>` keep the fused rim, shadow, and refraction smooth at full screen density during motion.

The group also shares one decision about text color. The tab bar checks what's behind it and chooses light or dark text, and every other shape in the group follows, so the whole group always matches.
