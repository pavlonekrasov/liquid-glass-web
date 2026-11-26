import assert from "node:assert/strict";
import test from "node:test";

import {
  GLASS_PHYSICS,
  GLASS_SPRINGS,
  glassDeformationForSize,
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
