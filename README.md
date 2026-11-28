# liquid-glass-web

> Apple's **Liquid Glass** for the web: React components that refract and light whatever is behind them, like real glass.

**Live demo:** [liquidglass.pavlonekrasov.com](https://liquidglass.pavlonekrasov.com) · **Material Lab:** [liquidglass.pavlonekrasov.com/lab](https://liquidglass.pavlonekrasov.com/lab)

Most "glass" on the web is a blurred box. `liquid-glass-web` bends the content behind it the way real glass does, with soft rainbow edges and highlights that catch the light, so it looks like the glass in iOS 26. Shapes melt into each other when they get close, controls spring like native ones, and text on top stays readable while the page scrolls. It works in every major browser and picks the best rendering each one supports.

---

## What's included

1. **npm package (`packages/liquid-glass-web`):** React components (`@pavlonekrasov/liquid-glass-web`), their styles (`@pavlonekrasov/liquid-glass-web/styles.css`), and the underlying math on its own, with no React or DOM (`@pavlonekrasov/liquid-glass-web/core`).
2. **Demo site & Material Lab ([live](https://liquidglass.pavlonekrasov.com)):** See the components in a real scrolling page ([`/`](https://liquidglass.pavlonekrasov.com)), then tune every setting with sliders in the [Material Lab](https://liquidglass.pavlonekrasov.com/lab) and copy the TSX ot JSX.
3. **Agent Skill (`skills/liquid-glass-web/SKILL.md`):** Teaches coding agents (Claude Code, Cursor, Codex, Antigravity) how to use the library correctly.

---

## Quick Start

```bash
npm install @pavlonekrasov/liquid-glass-web
# or
pnpm add @pavlonekrasov/liquid-glass-web
```

Spring animations use [Motion](https://motion.dev), a peer dependency. npm 7+, pnpm 8+ and bun
install it for you; with Yarn, run `yarn add motion` as well.

To teach your coding agent the API, add the Agent Skill:

```bash
npx skills add pavlonekrasov/liquid-glass-web
```

The skill is updated with every release. To pull the latest, or to see whether yours is behind:

```bash
npx skills update liquid-glass-web
npx skills check
```

```tsx
import {
  GlassStage,
  GlassContainer,
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
} from "@pavlonekrasov/liquid-glass-web";
import "@pavlonekrasov/liquid-glass-web/styles.css";

export function NavigationShell() {
  return (
    <GlassStage engine="auto">
      <YourScrollablePageContent />

      <GlassStage.Chrome>
        <GlassContainer id="nav" mergeRadius={22}>
          <GlassTabBar
            variant="regular"       // "regular" | "clear" | "tinted"
            interactive             // glows and squishes when pressed
            adaptiveContrast        // keeps labels readable over any background
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

Shapes inside a `GlassContainer` merge into one piece of glass when they come within `mergeRadius` of each other.

With server rendering (Next.js App Router, Remix), add this script to `<head>` so Chromium gets the full effect from the first frame:

```tsx
import { CHROMIUM_REFRACT_INIT_SCRIPT } from "@pavlonekrasov/liquid-glass-web";

<script dangerouslySetInnerHTML={{ __html: CHROMIUM_REFRACT_INIT_SCRIPT }} />
```

---

## Variants

| Variant | Look | Best for |
| --- | --- | --- |
| `regular` *(default)* | Lightly frosted, balances see-through and readable | Most UI: nav bars, toolbars, scrolling pages |
| `clear` | Barely frosted, the most see-through | Photos, video, dark scenes |
| `tinted` | Heavily frosted, closer to solid | Text-heavy or very bright pages |

Fine-tune with props like `refraction`, `dispersion` and `frost`, or pass `optics={{ ... }}` for full control.

---

## Browser Support

`engine="auto"` picks the best option for each browser:

| Engine | Browser | What you get |
| --- | --- | --- |
| `html-in-canvas` | Chrome 157+ | The full effect, rendered with WebGL |
| `svg-backdrop` | Other Chromium browsers (Chrome, Edge, Arc…) | Full refraction through a fast SVG filter |
| `svg-content` | Safari & Firefox | Refraction and rainbow edges through an SVG fallback |
| `frost` | Reduced transparency, high contrast or forced colors | Solid, high-contrast surfaces |

---

## Accessibility

- **Real controls:** proper HTML and ARIA roles with full keyboard support for the tab bar, switch and slider, and touch targets of at least 44×44 px.
- **Readable text:** labels keep WCAG AA contrast (4.5:1) as content scrolls behind the glass, without flickering.
- **Respects user settings:** reduced motion, reduced transparency, increased contrast and forced colors.

---

## Development

```bash
pnpm install
pnpm test            # Unit tests
pnpm typecheck       # TypeScript checks
pnpm lint            # ESLint
pnpm build           # Build the package and the demo site
pnpm publint         # Check the package's exports
pnpm dev             # Run the demo site (/) and Material Lab (/lab)
```

Visual checks in real browsers at several screen densities:

```bash
# Chrome
CHANNEL=chrome node scripts/verify-visuals.mjs

# Firefox
pnpm verify:firefox
```

Curious how it works under the hood? See [docs/architecture.md](docs/architecture.md).

### Releasing

The Agent Skill in `skills/liquid-glass-web` installs from this repo's main branch, so each release updates it too:

1. Bump `version` in `packages/liquid-glass-web/package.json`.
2. Run `pnpm skill:version` to give the skill the same version.
3. Update the skill for anything the release adds, renames or removes, then run `pnpm test`. A contract test fails if the
   skill names a component, variant, engine or optics key the library no longer has, misses a new optics key, quotes a
   stale glass budget, or carries a different version.
4. Commit, push and publish. People who installed the skill get it with `npx skills update`.

---

## Credits

- **[DialKit](https://dialkit.dev)** by **[Josh Puckett](https://github.com/joshpuckett/dialkit)**: the slider panel behind the [Material Lab](https://liquidglass.pavlonekrasov.com/lab).
- **Apple's Liquid Glass (WWDC 2025)**: the design language, including merging shapes, the touch glow and spring motion.
- **Aave**: the SVG technique used for refraction in Safari and Firefox.

## License

MIT
