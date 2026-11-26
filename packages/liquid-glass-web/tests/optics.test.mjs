import assert from "node:assert/strict";
import test from "node:test";

import {
  BK7,
  buildClampTable,
  buildDisplacementTiles,
  cauchyIor,
  contentSpectralBandAlpha,
  GLASS_VARIANTS,
  HIC_SPECTRAL_BANDS,
  lensLayout,
  lightingOverlay,
  NEUTRAL,
  overlayPieces,
  rawDisplacementAt,
  SPECTRAL_BANDS,
  spectralDelta,
  tintField,
} from "../src/core/index.ts";

const near = (actual, expected, tol, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: got ${actual}, expected ${expected} ± ${tol}`,
  );

const BK7_IOR = BK7.nd;

test("Snell profiles reproduce physical table (circle & c2squircle, h(0)=0)", () => {
  const cases = [
    ["circle", 12, 16, BK7_IOR, null, 4.59, 2.3, 0.39, 12.0],
    ["circle", 16, 22, BK7_IOR, null, 6.45, 3.12, 0.36, 16.0],
    ["circle", 18, 24, BK7_IOR, null, 6.89, 3.45, 0.39, 18.0],
    ["circle", 20, 28, BK7_IOR, null, 8.3, 3.95, 0.33, 20.0],
    ["circle", 24, 34, BK7_IOR, null, 10.16, 4.78, 0.32, 24.0],
    ["c2squircle", 16, 22, BK7_IOR, 0.25, 7.58, 0.12, 0.25, 16.0],
    ["c2squircle", 20, 28, BK7_IOR, 0.25, 9.54, 0.15, 0.25, 20.0],
    ["c2squircle", 24, 34, 1.55, 0.25, 11.61, 0.14, 0.25, 24.0],
  ];

  for (const [profile, bezel, thickness, ior, clampJ, dMax, atS, minJ, maxReach] of cases) {
    const res = buildClampTable({
      profile,
      bezel,
      thickness,
      ior,
      minJacobian: clampJ ?? 0.2,
      maxMultiplier: 1,
    });
    const step = bezel / (res.clamped.length - 1);
    let peakS = 0;
    let peakD = 0;
    let reach = 0;
    for (let i = 0; i < res.clamped.length; i++) {
      const s = i * step;
      if (res.clamped[i] > peakD) {
        peakD = res.clamped[i];
        peakS = s;
      }
      reach = Math.max(reach, s + res.clamped[i]);
    }
    near(res.dMax, dMax, 0.08, `${profile} b=${bezel} T=${thickness} dMax`);
    near(peakS, atS, 0.15, `${profile} b=${bezel} T=${thickness} s_peak`);
    near(res.clampedMinJacobian, minJ, 0.04, `${profile} b=${bezel} T=${thickness} minJ`);
    near(reach, maxReach, 0.08, `${profile} b=${bezel} T=${thickness} maxReach`);
  }
});

test("boundary continuity: d(0) === 0 and d(b) === 0 for every shipped variant (no H0 teleport)", () => {
  for (const [name, c] of Object.entries(GLASS_VARIANTS)) {
    assert.ok(
      c.profile === "circle" || c.profile === "c2squircle" || c.profile === "squircle",
      `${name}: non-physical profile "${c.profile}" is forbidden`,
    );
    assert.equal("elevation" in c, false, `${name}: H0 elevation breaks h(0)=0 continuity`);

    for (const [part, bezel, thickness] of [
      ["bar", c.bezel, c.thickness],
      ["loupe", c.loupeBezel, c.loupeThickness],
    ]) {
      const optics = {
        profile: c.profile,
        bezel,
        thickness,
        ior: c.ior,
        minJacobian: c.minJacobian,
      };
      assert.equal(rawDisplacementAt(optics, 0), 0, `${name} ${part}: d(0) must be 0`);
      assert.equal(rawDisplacementAt(optics, bezel), 0, `${name} ${part}: d(b) must be 0`);
      assert.ok(
        rawDisplacementAt(optics, bezel * 0.1) > 0,
        `${name} ${part}: must refract inward inside bezel`,
      );
    }
  }
});

test("every shipped variant stays strictly fold-free (minJ >= 0.20) on Blue under press and b <= R", () => {
  const BAR_RADIUS = 30;
  const LOUPE_RADIUS = 33;
  const PRESS_GAIN = 1.12;

  for (const [name, c] of Object.entries(GLASS_VARIANTS)) {
    assert.ok(c.bezel <= BAR_RADIUS, `${name}: bar bezel ${c.bezel} > R ${BAR_RADIUS}`);
    assert.ok(c.loupeBezel <= LOUPE_RADIUS, `${name}: loupe bezel ${c.loupeBezel} > R ${LOUPE_RADIUS}`);

    for (const [part, bezel, thickness, strength, disp] of [
      ["bar", c.bezel, c.thickness, c.strength, c.dispersion],
      ["loupe", c.loupeBezel, c.loupeThickness, c.loupeStrength, c.loupeDispersion],
    ]) {
      const bFactor = 1 + disp * 0.14 * 1.1;
      const maxMultiplier = Math.max(1, strength) * (c.pressCompression ? PRESS_GAIN : 1) * bFactor;
      const stats = buildClampTable({
        profile: c.profile,
        bezel,
        thickness,
        ior: c.ior,
        minJacobian: c.minJacobian,
        maxMultiplier,
      });
      assert.ok(
        stats.clampedMinJacobian >= 0.2 - 1e-3,
        `${name} ${part}: Blue minJacobian ${stats.clampedMinJacobian.toFixed(3)} < 0.20`,
      );
    }
  }
});

test("displacement tiles encode exact neutral 128 center and lossless quadrant symmetry", () => {
  const optics = { profile: "circle", bezel: 16, thickness: 22, ior: BK7_IOR, minJacobian: 0.22 };
  const tiles = buildDisplacementTiles(30, optics, 2);
  assert.equal(tiles.neutral.data[0], NEUTRAL);
  assert.equal(tiles.neutral.data[1], NEUTRAL);
  assert.equal(tiles.neutral.data[3], 255);

  // Corner mirroring exact inverse: R_tr(x, y) + R_tl(w-1-x, y) === 256
  const { tl, tr, bl } = tiles.corners;
  const w = tl.width;
  for (let y = 0; y < w; y += 7) {
    for (let x = 0; x < w; x += 7) {
      const i = (y * w + x) * 4;
      const mx = (y * w + (w - 1 - x)) * 4;
      const my = ((w - 1 - y) * w + x) * 4;
      assert.equal(tr.data[i] + tl.data[mx], 256, "horizontal mirror R exact inverse");
      assert.equal(bl.data[i + 1] + tl.data[my + 1], 256, "vertical mirror G exact inverse");
    }
  }

  const layout = lensLayout(354, 60, 30, 16);
  assert.equal(layout.edges.left, null, "pill ends have no vertical straight strip");
  assert.ok(layout.edges.top && layout.edges.top.height === 16);
});

test("Fresnel rim derives from real 3D bezel normal: smooth decay across 1x-3x, zero wireframe", () => {
  const spec = {
    angleDeg: -90,
    lift: 0.55,
    exponent: 2.2,
    backBounce: 0.55,
    highlight: { r: 255, g: 255, b: 255, a: 0.9 },
    shade: { r: 10, g: 14, b: 24, a: 0.08 },
  };

  for (const [label, radius, bezel, thickness, loRatio, hiRatio] of [
    ["bar b=16 T=22", 29, 16, 22, 0.22, 0.5],
    ["loupe b=20 T=28", 41, 20, 28, 0.28, 0.55],
  ]) {
    for (const dpr of [1, 2, 3]) {
      const { alpha } = lightingOverlay(
        radius,
        { profile: "circle", bezel, thickness, ior: BK7_IOR, minJacobian: 0.2 },
        spec,
        dpr,
      );
      const mid = alpha.slice;
      const cssRowAlpha = (cssRow) => {
        let sum = 0;
        for (let k = 0; k < dpr; k++) {
          const y = cssRow * dpr + k;
          sum += alpha.alpha[y * alpha.size + mid] / 255;
        }
        return sum / dpr;
      };

      const r0 = cssRowAlpha(0);
      const r1 = cssRowAlpha(1);
      const r2 = cssRowAlpha(2);
      const r3 = cssRowAlpha(3);

      near(r0, spec.highlight.a, 3 / 255, `${label} @${dpr}x row 0 peak`);
      const ratio1 = r1 / r0;
      assert.ok(
        ratio1 >= loRatio && ratio1 <= hiRatio,
        `${label} @${dpr}x: row1/row0=${ratio1.toFixed(3)} outside [${loRatio}, ${hiRatio}]`,
      );
      assert.ok(r1 > r2 && r2 > r3, `${label} @${dpr}x must decay monotonically`);
      assert.equal(alpha.alpha[mid * alpha.size + mid], 0, `${label} @${dpr}x plateau unlit`);
    }
  }

  for (const [name, c] of Object.entries(GLASS_VARIANTS)) {
    assert.equal("ambientRim" in c, false, `${name}: forbidden uniform ambientRim wireframe`);
  }
});

test("5-band spectral weights sum to (1,1,1) white and order monotonically red -> blue", () => {
  assert.equal(SPECTRAL_BANDS.length, 5);
  near(SPECTRAL_BANDS.reduce((s, b) => s + b.r, 0), 1, 1e-6, "5-band sum R");
  near(SPECTRAL_BANDS.reduce((s, b) => s + b.g, 0), 1, 1e-6, "5-band sum G");
  near(SPECTRAL_BANDS.reduce((s, b) => s + b.b, 0), 1, 1e-6, "5-band sum B");

  for (let i = 1; i < SPECTRAL_BANDS.length; i++) {
    assert.ok(SPECTRAL_BANDS[i].offset > SPECTRAL_BANDS[i - 1].offset);
  }
  assert.ok(
    SPECTRAL_BANDS[0].offset < 0 &&
      SPECTRAL_BANDS[2].offset === 0 &&
      SPECTRAL_BANDS[4].offset > 0,
  );

  const regular = GLASS_VARIANTS.regular;
  assert.equal(regular.dispersion, 0, "resting bar dispersion defaults to 0");
  const loupeStats = buildClampTable({
    profile: regular.profile,
    bezel: regular.loupeBezel,
    thickness: regular.loupeThickness,
    ior: regular.ior,
    minJacobian: regular.minJacobian,
    maxMultiplier: 1.2,
  });
  const delta = spectralDelta(regular.loupeDispersion);
  const spread =
    loupeStats.dMax *
    regular.loupeStrength *
    (SPECTRAL_BANDS[4].offset - SPECTRAL_BANDS[0].offset) *
    delta;
  assert.ok(spread >= 0.8 && spread <= 1.85, `regular loupe spread ${spread.toFixed(2)}px in [0.8, 1.85]`);
});

test("Aave content-path 5-band premultiplied alpha preserves #ffffff, AA strokes, and A=0", () => {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  for (const band of SPECTRAL_BANDS) {
    const aW = contentSpectralBandAlpha(band);
    assert.ok(aW > 0 && aW <= 1);
    sumR += band.r;
    sumG += band.g;
    sumB += band.b;
    sumA += aW;
  }
  near(sumR, 1, 1e-6, "content-path R sum");
  near(sumG, 1, 1e-6, "content-path G sum");
  near(sumB, 1, 1e-6, "content-path B sum");
  near(sumA, 1, 1e-6, "content-path A sum");

  for (const [label, r, g, b, a] of [
    ["transparent", 0, 0, 0, 0],
    ["opaque white", 1, 1, 1, 1],
    ["anti-aliased white", 1, 1, 1, 0.35],
    ["anti-aliased black", 0, 0, 0, 0.35],
    ["iOS systemBlue", 0, 0.48, 1, 0.6],
  ]) {
    const rPre = r * a * sumR;
    const gPre = g * a * sumG;
    const bPre = b * a * sumB;
    const outA = 1 - (1 - a * sumA);
    near(rPre, r * a, 1e-6, `${label} R_pre`);
    near(gPre, g * a, 1e-6, `${label} G_pre`);
    near(bPre, b * a, 1e-6, `${label} B_pre`);
    near(outA, a, 1e-6, `${label} A_out`);
  }
});

test("seam-free overlays hold cut <= 2 and pad > 1 across 1x, 1.25x, 1.5x, 1.75x, 2x, 3x DPR", () => {
  const optics = { profile: "circle", bezel: 20, thickness: 28, ior: BK7_IOR, minJacobian: 0.2 };
  const spec = {
    angleDeg: -125,
    lift: 0.55,
    exponent: 2.2,
    backBounce: 0.55,
    highlight: { r: 255, g: 255, b: 255, a: 0.88 },
    shade: { r: 10, g: 14, b: 24, a: 0.1 },
  };

  for (const dpr of [1, 1.25, 1.5, 1.75, 2, 3]) {
    const { alpha } = lightingOverlay(41, optics, spec, dpr);
    const tint = tintField(41, optics, 0.18, 0.02, dpr, 1);
    for (const [kind, sheet] of [
      ["light", alpha],
      ["tint", tint],
    ]) {
      const p = overlayPieces(sheet, 1, 1);
      assert.ok(p.cut <= 2, `${kind} @${dpr}x side-band cut ${p.cut}/255 > 2`);
      assert.ok(p.pad > 1, `${kind} @${dpr}x pad ${p.pad} must clear 1px inset`);
    }
  }
});

test("Tier 0 HTML-in-Canvas 11-band Cauchy weights sum to (1,1,1) and increase red -> violet", () => {
  assert.equal(HIC_SPECTRAL_BANDS.length, 11);
  near(HIC_SPECTRAL_BANDS.reduce((s, b) => s + b.r, 0), 1, 1e-6, "11-band R sum");
  near(HIC_SPECTRAL_BANDS.reduce((s, b) => s + b.g, 0), 1, 1e-6, "11-band G sum");
  near(HIC_SPECTRAL_BANDS.reduce((s, b) => s + b.b, 0), 1, 1e-6, "11-band B sum");

  let prevN = 0;
  for (const band of HIC_SPECTRAL_BANDS) {
    const n = cauchyIor(BK7_IOR, band.um, 0.62);
    assert.ok(n > prevN, `band ${band.nm}nm IOR ${n.toFixed(4)} must exceed ${prevN.toFixed(4)}`);
    assert.ok(n >= 1.45 && n <= 1.75);
    prevN = n;
    near(cauchyIor(BK7_IOR, band.um, 0), BK7_IOR, 1e-6, `band ${band.nm}nm zero dispersion`);
  }
});
