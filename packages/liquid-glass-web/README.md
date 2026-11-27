# @pavlonekrasov/liquid-glass-web

Physically grounded **Apple iOS 26/27 Liquid Glass** material and interactive component system for the web.

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
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
} from "@pavlonekrasov/liquid-glass-web";
import "@pavlonekrasov/liquid-glass-web/styles.css";
```

Pure zero-DOM physics utilities are available at `@pavlonekrasov/liquid-glass-web/core`.

Try it live at [liquidglass.pavlonekrasov.com](https://liquidglass.pavlonekrasov.com) and tune every parameter in the [Material Lab](https://liquidglass.pavlonekrasov.com/lab).

See the [repository README](https://github.com/pavlonekrasov/liquid-glass-web) for full documentation and the Agent Skill.
