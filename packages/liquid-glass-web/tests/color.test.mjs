import assert from "node:assert/strict";
import test from "node:test";

import {
  cssColorFormat,
  formatCssColor,
  hexToRgb,
  parseCssColor,
  resolveGlassConfig,
} from "../src/core/index.ts";

const near = (actual, expected, tolerance, label) => {
  assert.ok(actual, `${label}: did not parse`);
  for (const ch of ["r", "g", "b"]) {
    assert.ok(
      Math.abs(actual[ch] - expected[ch]) <= tolerance,
      `${label}: ${ch} ${actual[ch].toFixed(2)} vs ${expected[ch]}`,
    );
  }
};

const RED = { r: 255, g: 0, b: 0 };

test("every CSS color syntax for sRGB red resolves to sRGB red", () => {
  const reds = [
    "#f00",
    "#ff0000",
    "#FF0000FF",
    "red",
    "rgb(255, 0, 0)",
    "rgb(255 0 0)",
    "rgb(100% 0% 0%)",
    "rgba(255,0,0,1)",
    "hsl(0 100% 50%)",
    "hsl(0, 100%, 50%)",
    "hsl(360deg 100 50)",
    "hsl(1turn 100% 50%)",
    "hwb(0 0% 0%)",
    "lab(54.29 80.8 69.89)",
    "lch(54.29 106.84 40.85)",
    "oklab(0.628 0.2249 0.1258)",
    "oklch(0.628 0.2577 29.23)",
    "oklch(62.8% 0.2577 29.23deg)",
    "color(srgb 1 0 0)",
    "color(srgb-linear 1 0 0)",
    "color(display-p3 0.9175 0.2003 0.1386)",
    "color(a98-rgb 0.8584 0 0)",
    "color(rec2020 0.7919 0.2309 0.0739)",
    "color(xyz-d65 0.4124 0.2126 0.0193)",
    "color(xyz 0.4124 0.2126 0.0193)",
    "color(xyz-d50 0.4361 0.2225 0.0139)",
  ];
  for (const css of reds) near(parseCssColor(css), RED, 2.5, css);
});

test("alpha is read from every syntax", () => {
  assert.equal(parseCssColor("rgb(255 0 0 / 50%)").alpha, 0.5);
  assert.equal(parseCssColor("rgba(255, 0, 0, 0.25)").alpha, 0.25);
  assert.equal(parseCssColor("oklch(0.6 0.1 200 / 0.4)").alpha, 0.4);
  assert.equal(parseCssColor("color(display-p3 1 1 1 / 0.3)").alpha, 0.3);
  assert.ok(Math.abs(parseCssColor("#ff000080").alpha - 128 / 255) < 1e-9);
  assert.equal(parseCssColor("transparent").alpha, 0);
  assert.equal(parseCssColor("red").alpha, 1);
});

test("wide-gamut colors are gamut mapped into sRGB, keeping hue", () => {
  const p3Red = parseCssColor("color(display-p3 1 0 0)");
  assert.ok(p3Red.r > 250 && p3Red.g < 40 && p3Red.b < 40, JSON.stringify(p3Red));
  const p3Green = parseCssColor("color(display-p3 0 1 0)");
  assert.ok(p3Green.g > 240 && p3Green.r < 60 && p3Green.b < 60, JSON.stringify(p3Green));
  const vivid = parseCssColor("oklch(0.7 0.4 145)");
  for (const ch of ["r", "g", "b"]) assert.ok(vivid[ch] >= 0 && vivid[ch] <= 255);
  assert.ok(vivid.g > vivid.r && vivid.g > vivid.b);
  near(parseCssColor("oklch(1.2 0.3 40)"), { r: 255, g: 255, b: 255 }, 0, "over-white");
  near(parseCssColor("lab(-10 20 20)"), { r: 0, g: 0, b: 0 }, 0, "under-black");
});

test("named colors, none, and invalid input", () => {
  near(parseCssColor("rebeccapurple"), { r: 0x66, g: 0x33, b: 0x99 }, 0, "rebeccapurple");
  near(parseCssColor("oklch(0.5 none none)"), parseCssColor("oklch(0.5 0 0)"), 0, "none");
  for (const bad of ["", "nope", "#12", "rgb(1 2)", "oklch(a b c)", "color(foo 1 2 3)", "var(--x)"]) {
    assert.equal(parseCssColor(bad), null, bad);
  }
});

test("formatCssColor writes each format and parses back to the same color", () => {
  const formats = ["hex", "rgb", "hsl", "hwb", "lab", "lch", "oklab", "oklch", "display-p3"];
  const samples = [
    { r: 14, g: 18, b: 28, alpha: 1 },
    { r: 250, g: 251, b: 254, alpha: 0.5 },
    { r: 200, g: 40, b: 120, alpha: 1 },
  ];
  for (const color of samples) {
    for (const format of formats) {
      const css = formatCssColor(color, format);
      assert.equal(cssColorFormat(css), format, css);
      const back = parseCssColor(css);
      near(back, color, 0.8, `${format} ${css}`);
      assert.ok(Math.abs(back.alpha - color.alpha) < 0.005, `${css} alpha`);
    }
  }
});

test("hexToRgb keeps working and now takes any CSS color", () => {
  assert.deepEqual(hexToRgb("#0e121c"), { r: 14, g: 18, b: 28 });
  assert.deepEqual(hexToRgb("0e121c"), { r: 14, g: 18, b: 28 });
  near(hexToRgb("oklch(0.628 0.2577 29.23)"), RED, 2.5, "oklch via hexToRgb");
  assert.deepEqual(hexToRgb("bogus", { r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
});

test("resolveGlassConfig accepts any CSS tint and scales body opacity by its alpha", () => {
  const solid = resolveGlassConfig({ optics: { tintColor: "#0e121c", bodyOpacity: 0.4 } });
  const oklch = resolveGlassConfig({
    optics: { tintColor: formatCssColor({ r: 14, g: 18, b: 28 }, "oklch"), bodyOpacity: 0.4 },
  });
  near(oklch.tintColor, solid.tintColor, 0.5, "oklch tint");
  assert.equal(solid.tintAlpha, 0.4);

  const half = resolveGlassConfig({ optics: { tintColor: "color(display-p3 0 0 1 / 0.5)", bodyOpacity: 0.4 } });
  assert.ok(Math.abs(half.tintAlpha - 0.2) < 1e-9);
  assert.ok(half.tintColor.b > 200);

  const fallback = resolveGlassConfig({ optics: { tintColor: "not-a-color" } });
  assert.deepEqual(fallback.tintColor, resolveGlassConfig({}).tintColor);
});
