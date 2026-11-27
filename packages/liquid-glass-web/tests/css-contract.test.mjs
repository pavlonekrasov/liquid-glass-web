import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("library CSS enforces -webkit-backdrop-filter order, border-radius: inherit, and all 4 a11y media queries", () => {
  const css = readFileSync(new URL("../src/styles/styles.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  // Every backdrop-filter declaration block must have -webkit-backdrop-filter before backdrop-filter
  const rules = css.split("}");
  for (const rule of rules) {
    if (!/(?<!-webkit-)backdrop-filter/.test(rule)) continue;
    const wk = rule.indexOf("-webkit-backdrop-filter");
    const std = rule.search(/(?<!-webkit-)backdrop-filter/);
    assert.ok(
      wk >= 0 && std > wk,
      `Every rule using backdrop-filter must put -webkit-backdrop-filter before backdrop-filter:\n${rule.trim()}`,
    );
  }

  // ::before and ::after on .lgw-glass-surface must inherit border-radius
  assert.match(
    css,
    /\.lgw-glass-surface\[data-lgw-lit\]::before[\s\S]*?border-radius:\s*inherit/,
    "Beer-Lambert ::before must set border-radius: inherit",
  );
  assert.match(
    css,
    /\.lgw-glass-surface\[data-lgw-lit\]::after[\s\S]*?border-radius:\s*inherit/,
    "Fresnel ::after must set border-radius: inherit",
  );

  // Animating background-color on ::before flashes white in Chromium
  const beforeBlock =
    /\.lgw-glass-surface\[data-lgw-lit\]::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.equal(
    /transition\s*:[^;]*background-color/.test(beforeBlock),
    false,
    "::before must never transition background-color when -webkit-mask-box-image is used",
  );

  // All 4 accessibility media queries must be honored
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /prefers-reduced-transparency:\s*reduce/);
  assert.match(css, /prefers-contrast:\s*more/);
  assert.match(css, /forced-colors:\s*active/);

  // Non-interactive loupe overlays must never inherit pointer-events: auto from .lgw-chrome
  assert.match(
    css,
    /\.lgw-chrome\s+\.lgw-glass-surface:not\(\.lgw-loupe\):not\(\.lgw-switch__loupe\):not\(\.lgw-slider__loupe\)/,
    ".lgw-chrome must exclude .lgw-loupe overlays from pointer-events: auto so active-tab scrubbing works",
  );
});
