# @pavlonekrasov/liquid-glass-web

Apple's **Liquid Glass** for the web: React components that refract and light whatever is behind them, like real glass.

## Install

```bash
npm install @pavlonekrasov/liquid-glass-web
```

Spring animations use [Motion](https://motion.dev), a peer dependency. npm 7+, pnpm 8+ and bun
install it for you; with Yarn, run `yarn add motion` as well.

## Usage

```tsx
import {
  GlassStage,
  GlassContainer,
  GlassSurface,
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
  GlassButton,
  GlassScrollEdge,
} from "@pavlonekrasov/liquid-glass-web";
import "@pavlonekrasov/liquid-glass-web/styles.css";
```

The underlying math, with no React or DOM, is available at `@pavlonekrasov/liquid-glass-web/core`.

Try it live at [liquidglass.pavlonekrasov.com](https://liquidglass.pavlonekrasov.com) and tune every parameter in the [Material Lab](https://liquidglass.pavlonekrasov.com/lab).

See the [repository README](https://github.com/pavlonekrasov/liquid-glass-web) for full documentation and the Agent Skill.
