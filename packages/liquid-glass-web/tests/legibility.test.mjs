import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POLARITY_DWELL_MS,
  solveAdaptiveLegibility,
  stabilizePolarity,
} from "../src/core/index.ts";

test("scroll-adaptive legibility guarantees >= 4.5:1 WCAG AA across dark, light, coral, gold, and checkerboard scenes", () => {
  const scenes = [
    ["Dark Plasma + Gold Wave", [[7, 25, 29], [16, 48, 54], [202, 148, 30], [184, 132, 24]], 0.18],
    ["Pure Daylight White", [[255, 255, 255], [248, 250, 252], [240, 242, 246]], 0.3],
    ["Dark Alpine Card on Light UI", [[29, 62, 114], [43, 125, 233], [13, 27, 42]], 0.3],
    ["Shibuya + Citrus Split", [[11, 16, 38], [26, 11, 46], [0, 229, 255], [255, 81, 47], [255, 224, 0]], 0.3],
    ["Mid-Luminance Sunset Coral", [[44, 30, 90], [200, 75, 107], [255, 123, 84]], 0.3],
    ["High-Variance Checkerboard", [[24, 27, 34], [243, 244, 246], [24, 27, 34], [243, 244, 246]], 0.18],
    ["Half-and-Half Split", [[255, 255, 255], [255, 255, 255], [9, 11, 16], [9, 11, 16]], 0.18],
    ["Pure OLED Black", [[7, 9, 14], [10, 12, 18]], 0.18],
  ];

  for (const [name, samples, baseTintAlpha] of scenes) {
    const res = solveAdaptiveLegibility(samples, { baseTintAlpha });
    assert.ok(
      res.worstContrast >= 4.8,
      `${name}: worst-case WCAG contrast ${res.worstContrast.toFixed(2)}:1 < 4.8:1`,
    );
    assert.ok(
      res.scrimAlpha >= 0 && res.scrimAlpha <= 0.85,
      `${name}: scrimAlpha ${res.scrimAlpha} out of [0, 0.85]`,
    );
  }
});

test("anti-flash regressions: gold plasma crest and 2-of-10 card gaps never flash dark glass to white", () => {
  // Dark Alpine card over daylight UI flips cleanly to light ink on dark glass
  const alpine = solveAdaptiveLegibility(
    [
      [29, 62, 114],
      [13, 27, 42],
    ],
    { baseTintAlpha: 0.3, previousPolarity: "dark" },
  );
  assert.equal(alpine.polarity, "light");
  assert.equal(alpine.scrimAlpha, 0);

  // Moving bright gold plasma crest must stay light-on-dark
  const goldCrest = solveAdaptiveLegibility(
    [
      [206, 162, 42],
      [198, 150, 36],
    ],
    { baseTintAlpha: 0.18, previousPolarity: "light" },
  );
  assert.equal(goldCrest.polarity, "light");
  assert.ok(goldCrest.worstContrast >= 4.8);

  // 2-of-10 white gap samples between dark cards must never glitch polarity to dark-on-white
  const gapPolarity = [
    [11, 16, 38],
    [26, 11, 46],
    [26, 11, 46],
    [44, 30, 90],
    [11, 16, 38],
    [26, 11, 46],
    [44, 30, 90],
    [200, 75, 107],
    [244, 245, 247],
    [244, 245, 247],
  ];
  const cardGap = solveAdaptiveLegibility(
    [
      [11, 16, 38],
      [244, 245, 247],
    ],
    {
      baseTintAlpha: 0.3,
      polaritySamples: gapPolarity,
      previousPolarity: "light",
    },
  );
  assert.equal(cardGap.polarity, "light");
});

test("temporal polarity dwell prevents rapid chatter across scroll boundaries", () => {
  let state = { committed: null, candidate: null, candidateSince: null };
  const init = stabilizePolarity(state, "light", 0);
  assert.equal(init.committed, "light");
  state = init.state;

  // Brief dark-ink observation at t=100ms does not commit immediately
  const step1 = stabilizePolarity(state, "dark", 100);
  assert.equal(step1.committed, null);
  assert.equal(step1.state.committed, "light");
  state = step1.state;

  // Still below 220ms dwell at t=260ms
  const step2 = stabilizePolarity(state, "dark", 260);
  assert.equal(step2.committed, null);
  state = step2.state;

  // Commits cleanly once dwell >= DEFAULT_POLARITY_DWELL_MS (220ms)
  const step3 = stabilizePolarity(state, "dark", 100 + DEFAULT_POLARITY_DWELL_MS);
  assert.equal(step3.committed, "dark");
  assert.equal(step3.state.committed, "dark");
});
