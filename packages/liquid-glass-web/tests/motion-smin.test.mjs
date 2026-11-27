import assert from "node:assert/strict";
import test from "node:test";

import {
  bakePolySminOptics,
  buildCapsuleDisplacementMap,
  buildPolySminDisplacementMap,
  buildPolySminPath,
  GLASS_PHYSICS,
  GLASS_SPRINGS,
  glassDeformationForSize,
  NEUTRAL,
  polySmin,
  projectMomentum,
  resolveGlassConfig,
  resolveGlassTransitionMode,
  rubberband,
  springDampingRatio,
  springFromDurationBounce,
  tapFlightBell,
  velocityStretch,
} from "../src/core/index.ts";

const near = (actual, expected, tol, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: got ${actual}, expected ${expected} ± ${tol}`,
  );

test("Apple HIG springs omit duration and bounce keys so motion/react runs true physics", () => {
  for (const [name, sp] of Object.entries(GLASS_SPRINGS)) {
    assert.equal(
      "duration" in sp,
      false,
      `GLASS_SPRINGS.${name} MUST NOT emit duration (causes 50ms snap in motion/react)`,
    );
    assert.equal(
      "bounce" in sp,
      false,
      `GLASS_SPRINGS.${name} MUST NOT emit bounce (causes motion/react override)`,
    );
    assert.equal(sp.type, "spring");
    assert.equal(sp.mass, 1);
    assert.ok(sp.stiffness > 0 && sp.damping > 0);
  }

  const custom = springFromDurationBounce(0.35, 0.15);
  assert.equal("duration" in custom, false);
  assert.equal("bounce" in custom, false);

  near(springDampingRatio(GLASS_SPRINGS.micro), 1.0, 0.01, "micro zeta");
  near(springDampingRatio(GLASS_SPRINGS.snappy), 1.0, 0.01, "snappy zeta");
  assert.ok(
    springDampingRatio(GLASS_SPRINGS.interactive) < 1.0 &&
      springDampingRatio(GLASS_SPRINGS.interactive) >= 0.75,
  );
  assert.ok(springDampingRatio(springFromDurationBounce(0.3, -0.2)) > 1.0);
});

test("size-proportional liquid deformation, rubberband, momentum, and tapFlightBell obey bounds", () => {
  const thumb = glassDeformationForSize(32, 20);
  const pill = glassDeformationForSize(84, 50);
  const bar = glassDeformationForSize(354, 62);

  assert.ok(thumb.maxVelocityStretch > pill.maxVelocityStretch);
  assert.ok(pill.maxVelocityStretch > bar.maxVelocityStretch);
  assert.ok(thumb.maxVelocityStretch < 0.1, "stretch stays strictly below 10% restraint ceiling");
  assert.ok(thumb.pressScale < pill.pressScale && pill.pressScale < bar.pressScale);
  assert.ok(velocityStretch(5, thumb.maxVelocityStretch) <= thumb.maxVelocityStretch);

  assert.equal(rubberband(0), 0);
  assert.ok(rubberband(20, 10, 0.36) > 0 && rubberband(20, 10, 0.36) < 10);
  assert.ok(rubberband(-20, 10, 0.36) < 0 && rubberband(-20, 10, 0.36) > -10);
  assert.ok(Math.abs(rubberband(10000, 10, 0.36)) < 10);

  assert.ok(projectMomentum(500) > 0 && projectMomentum(-500) < 0);
  assert.equal(tapFlightBell(0), 0);
  assert.equal(tapFlightBell(1), 0);
  near(tapFlightBell(0.5), 1.0, 1e-6, "tapFlightBell peak");

  assert.equal(resolveGlassTransitionMode("pointer", true), "instant");
  assert.equal(resolveGlassTransitionMode("keyboard", false), "snappy-no-loupe");
  assert.equal(resolveGlassTransitionMode("pointer", false), "full-liquid");
});

test("GlassContainer polySmin meniscus kisses cleanly at gap = k/2", () => {
  const k = GLASS_PHYSICS.sminMergeRadiusPx; // 22 px
  assert.ok(polySmin(7, 7, k) > 0, "14px gap (a=b=7) stays cleanly detached");
  near(polySmin(k / 4, k / 4, k), 0, 1e-6, "exact meniscus kiss at gap = k/2");
  assert.ok(polySmin(1.5, 1.5, k) < -2.0, "3px bridged gap forms thick refracting meniscus");
  assert.equal(polySmin(3, 5, 0), 3, "k=0 collapses to exact hard min");

  const bar = { cx: 177, cy: 31, hw: 177, hh: 31, r: 31 };
  const orbDetached = { cx: 354 + 14 + 30, cy: 31, hw: 30, hh: 30, r: 30 };
  const orbFused = { cx: 354 + 3 + 30, cy: 31, hw: 30, hh: 30, r: 30 };

  assert.equal(buildPolySminPath(bar, orbDetached, k), null, "14px gap stays detached");
  const fused = buildPolySminPath(bar, orbFused, k);
  assert.ok(fused !== null, "3px gap produces closed polySmin union contour");
  assert.ok(fused.path.startsWith("M ") && fused.path.endsWith(" Z"), "path is closed");
  assert.equal(fused.path.includes("NaN"), false, "zero NaN coordinates");
  assert.ok(fused.saddleDepth > 2.0, "deep liquid meniscus saddle");

  const cfg = resolveGlassConfig({ variant: "regular" });
  const disp = buildPolySminDisplacementMap(428, 62, bar, orbFused, k, {
    bezel: cfg.bezel,
    thickness: cfg.thickness,
    ior: cfg.ior,
    profile: cfg.profile,
    minJacobian: cfg.minJacobian,
  });
  assert.ok(disp.dMax > 0, "Snell displacement has positive dMax");
  const centerIdx = (31 * disp.tile.width + 177) * 4;
  assert.equal(disp.tile.data[centerIdx], NEUTRAL, "flat bar center R stays exact neutral 128");
  assert.equal(disp.tile.data[centerIdx + 1], NEUTRAL, "flat bar center G stays exact neutral 128");

  // Physical Fresnel + Beer–Lambert union canvas must light BOTH the bar's top-left AND the orb's top-left
  const optTile = bakePolySminOptics(428, 62, bar, orbFused, k, {
    optics: {
      bezel: cfg.bezel,
      thickness: cfg.thickness,
      ior: cfg.ior,
      profile: cfg.profile,
      minJacobian: cfg.minJacobian,
    },
    lighting: {
      angleDeg: cfg.lightAngleDeg,
      lift: cfg.lightLift,
      exponent: cfg.lightExponent,
      backBounce: cfg.backBounce,
      highlight: cfg.highlightColor,
      shade: cfg.shadeColor,
    },
    bodyRgb: { r: 12, g: 16, b: 26 },
    bodyAlpha: cfg.tintAlpha,
    rimAlphaMin: cfg.rimAlphaMin,
    scrimRgb: { r: 12, g: 16, b: 26 },
    scrimAlpha: 0,
    edgeRgb: { r: 255, g: 255, b: 255 },
    edgeAlpha: cfg.edgeRingAlpha,
    borderWidth: 1,
    scale: 1,
  });
  // Sample actual outer grazing rim pixel (s = 0.5px): bar top is y = 0, orb top is y = 1
  const orbTopRimIdx = (1 * optTile.width + Math.round(orbFused.cx)) * 4;
  const barTopRimIdx = (0 * optTile.width + 120) * 4;
  const barInnerIdx = (4 * optTile.width + 120) * 4;
  const barMidIdx = (31 * optTile.width + 177) * 4;
  assert.ok(
    optTile.data[orbTopRimIdx] > 180 && optTile.data[orbTopRimIdx + 3] > 100,
    "orb top bezel preserves physical 3D Fresnel specular highlight (never dark/flat)",
  );
  assert.ok(
    optTile.data[barTopRimIdx] > 180 && optTile.data[barTopRimIdx + 3] > 100,
    "bar top bezel preserves physical 3D Fresnel specular highlight",
  );
  assert.ok(
    optTile.data[barTopRimIdx + 3] > optTile.data[barInnerIdx + 3],
    "bar top rim decays smoothly inward (zero flat stepped band)",
  );
  assert.ok(
    optTile.data[barMidIdx] < 30 && optTile.data[barMidIdx + 3] > 20,
    "bar flat interior preserves translucent dark Beer–Lambert plateau",
  );

  // Unified pure-SDF outer shadow must have ZERO dark opaque fringe outside the top rim (no destination-out artifact)
  const paddedTile = bakePolySminOptics(428, 62, bar, orbFused, k, {
    optics: {
      bezel: cfg.bezel,
      thickness: cfg.thickness,
      ior: cfg.ior,
      profile: cfg.profile,
      minJacobian: cfg.minJacobian,
    },
    lighting: {
      angleDeg: cfg.lightAngleDeg,
      lift: cfg.lightLift,
      exponent: cfg.lightExponent,
      backBounce: cfg.backBounce,
      highlight: cfg.highlightColor,
      shade: cfg.shadeColor,
    },
    bodyRgb: { r: 250, g: 251, b: 254 },
    bodyAlpha: 0.34,
    rimAlphaMin: cfg.rimAlphaMin,
    scrimRgb: { r: 250, g: 251, b: 254 },
    scrimAlpha: 0,
    edgeRgb: { r: 15, g: 18, b: 26 },
    edgeAlpha: 0.14,
    borderWidth: 1,
    shadowAlpha: 0.06,
    padCss: 28,
    scale: 1,
  });
  // Pixel 1px ABOVE the bar's top rim (y = 28 - 2 = 26) must have whisper-light shadow only (alpha <= 12, never 37.5% = 96!)
  const aboveTopIdx = (26 * paddedTile.width + (28 + 120)) * 4;
  assert.ok(
    paddedTile.data[aboveTopIdx + 3] <= 12,
    `zero dark destination-out fringe above top rim (got alpha ${paddedTile.data[aboveTopIdx + 3]})`,
  );
  // Pixel 2px BELOW the bar's bottom rim (y = 28 + 62 + 2 = 92) has soft smooth contact shadow
  const belowBotIdx = (92 * paddedTile.width + (28 + 120)) * 4;
  assert.ok(
    paddedTile.data[belowBotIdx + 3] >= 4 && paddedTile.data[belowBotIdx + 3] <= 24,
    `soft outer contact shadow below bottom rim (got alpha ${paddedTile.data[belowBotIdx + 3]})`,
  );

  // Single-capsule motion displacement tile encodes transparent alpha outside capsule and neutral 128 inside center
  const orbMotion = buildCapsuleDisplacementMap(60, 60, 30, {
    bezel: cfg.bezel,
    thickness: cfg.thickness,
    ior: cfg.ior,
    profile: cfg.profile,
    minJacobian: cfg.minJacobian,
  });
  assert.ok(orbMotion.dMax > 0, "motion orb tile has positive Snell dMax");
  assert.equal(orbMotion.tile.data[3], 0, "outer corner of orb motion tile is transparent");
  const orbCenter = (30 * orbMotion.tile.width + 30) * 4;
  assert.equal(orbMotion.tile.data[orbCenter], NEUTRAL, "orb motion center R is exact neutral 128");
  assert.equal(orbMotion.tile.data[orbCenter + 3], 255, "orb motion center alpha is opaque");

  // Top rim on Paper stays bright white (Fresnel painted OVER 1px border, matching CSS stacking order)
  const paperTopRimIdx = (28 * paddedTile.width + (28 + 120)) * 4;
  assert.ok(
    paddedTile.data[paperTopRimIdx] > 215 && paddedTile.data[paperTopRimIdx + 3] > 140,
    `Paper top rim stays luminous white (got rgb=${paddedTile.data[paperTopRimIdx]}, a=${paddedTile.data[paperTopRimIdx + 3]})`,
  );

  // Non-capsule rounded rectangles (r < hh) emit exact corner arcs + vertical side segments
  const cardA = { cx: 60, cy: 40, hw: 50, hh: 30, r: 14 };
  const cardB = { cx: 164, cy: 40, hw: 50, hh: 30, r: 14 };
  const cardUnion = buildPolySminPath(cardA, cardB, 22);
  assert.ok(cardUnion !== null, "rounded-rect cards fuse cleanly");
  assert.ok(
    cardUnion.path.includes("A 14 14 0 0 1 10 56 L 10 24 A 14 14 0 0 1 24 10"),
    "rounded-rect left end emits two r=14 corner arcs with straight vertical edge (no distorted ellipse)",
  );
  assert.ok(
    cardUnion.path.includes("A 14 14 0 0 1 214 24 L 214 56 A 14 14 0 0 1 200 70"),
    "rounded-rect right end emits two r=14 corner arcs with straight vertical edge",
  );
});

test("semantic material variants resolve human-first props cleanly", () => {
  const reg = resolveGlassConfig({ variant: "regular" });
  const clr = resolveGlassConfig({ variant: "clear" });
  const tnt = resolveGlassConfig({ variant: "tinted" });

  assert.equal(reg.profile, "circle");
  assert.ok(clr.blur < reg.blur && reg.blur < tnt.blur);
  assert.ok(clr.tintAlpha < reg.tintAlpha && reg.tintAlpha < tnt.tintAlpha);

  const custom = resolveGlassConfig({
    variant: "regular",
    shapeProfile: "c2squircle",
    refraction: 1.15,
    dispersion: 0.8,
    frost: 3.5,
    interactive: false,
    optics: { tintColor: "#112233", lightAngle: -90 },
  });
  assert.equal(custom.profile, "c2squircle");
  assert.equal(custom.strength, 1.15);
  assert.equal(custom.loupeDispersion, 0.8);
  assert.equal(custom.blur, 3.5);
  assert.equal(custom.pressCompression, false);
  assert.deepEqual(custom.tintColor, { r: 17, g: 34, b: 51 });
  assert.equal(custom.lightAngleDeg, -90);
});
