// Headless Chrome checks across DPRs. Run with CHANNEL=chrome so installed Chrome
// renders backdrop-filter: url(#...), and Tier 0 on Chrome 157+.
//
// Usage:
//   CHANNEL=chrome node scripts/verify-visuals.mjs
//   BASE_URL=http://127.0.0.1:3000 CHANNEL=chrome node scripts/verify-visuals.mjs

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const channel = process.env.CHANNEL || "chrome";
const out = path.resolve(process.env.VERIFY_OUTPUT ?? "dist/verify-visuals");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {
  base,
  channel,
  browserVersion: null,
  when: new Date().toISOString(),
  errors: [],
  showcase: null,
  dialkitAttribution: null,
  tier0: null,
  tier1: {
    domState: null,
    outerEdgeGlitch: null,
    centerTextPurity: null,
    whiteAccuracy: null,
    rulerProbe: {},
    gestureBakes: null,
    tabSwitchPerf: null,
    daylightFeed: null,
  },
  tier2Aave: null,
  rimProfiles: {},
  gates: {},
  shots: [],
};

async function readPixels(page, pngBuf) {
  const b64 = pngBuf.toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data: rgba, width, height } = ctx.getImageData(0, 0, img.width, img.height);
    return { width, height, rgba: Array.from(rgba) };
  }, b64);
}

async function pixelDiff(page, bufA, bufB) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (s) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = [await load(a), await load(b)];
      let max = 0;
      let over2 = 0;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < p.length; i++) {
        if (i % 4 === 3) continue;
        const d = Math.abs(p[i] - q[i]);
        if (d > max) max = d;
        if (d > 2) over2++;
        sum += d;
        count++;
      }
      return { max, mean: +(sum / Math.max(1, count)).toFixed(3), over2, channels: count };
    },
    { a: bufA.toString("base64"), b: bufB.toString("base64") },
  );
}

async function saveContactSheet(page, rows, filePath) {
  const payload = rows.map((r) => ({
    title: r.title,
    images: r.buffers.map((b) => b.toString("base64")),
  }));
  const pngB64 = await page.evaluate(async (items) => {
    const load = async (s) => {
      const i = new Image();
      i.src = `data:image/png;base64,${s}`;
      await i.decode();
      return i;
    };
    const gap = 16;
    const labelH = 22;
    const loaded = [];
    for (const item of items) {
      loaded.push({ ...item, imgs: await Promise.all(item.images.map(load)) });
    }
    const width = Math.max(
      ...loaded.map((r) => r.imgs.reduce((acc, im) => acc + im.width + gap, gap)),
    );
    const height = loaded.reduce(
      (acc, r) => acc + Math.max(...r.imgs.map((im) => im.height)) + labelH + gap,
      gap,
    );
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, width, height);
    ctx.font = "13px system-ui, sans-serif";
    let y = gap;
    for (const r of loaded) {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(r.title, gap, y + 14);
      y += labelH;
      let x = gap;
      let rowH = 0;
      for (const im of r.imgs) {
        ctx.drawImage(im, x, y);
        x += im.width + gap;
        rowH = Math.max(rowH, im.height);
      }
      y += rowH + gap;
    }
    return c.toDataURL("image/png").split(",")[1];
  }, payload);
  writeFileSync(filePath, Buffer.from(pngB64, "base64"));
}

const browser = await chromium.launch({ channel, headless: true });
report.browserVersion = browser.version();

try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("ERR_NAME_NOT_RESOLVED")) {
      report.errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => report.errors.push(String(e)));

  // 1. Landing page
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await sleep(900);
  report.showcase = await page.evaluate(() => {
    const stage = document.querySelector("[data-lgw-tier]");
    return {
      tier: stage?.getAttribute("data-lgw-tier") ?? null,
      hasTabBar: Boolean(document.querySelector(".lgw-tabbar")),
      hasOrb: Boolean(document.querySelector(".lgw-orb")),
      hasSwitch: Boolean(document.querySelector(".lgw-switch")),
      hasSlider: Boolean(document.querySelector(".lgw-slider")),
      hasButton: Boolean(document.querySelector(".lgw-button")),
    };
  });
  await page.screenshot({ path: path.join(out, "00-showcase-landing-2x.png") });
  report.shots.push("00-showcase-landing-2x.png");

  // 2. Lab: DialKit, credit, Tier 0 merge
  await page.goto(`${base}/lab?paused=1`, { waitUntil: "networkidle" });
  await sleep(1000);

  report.dialkitAttribution = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    return {
      mentionsDialKit: bodyText.includes("DialKit"),
      mentionsJoshPuckett: bodyText.includes("Josh Puckett"),
      hasDialKitPanel: Boolean(document.querySelector('[class*="dialkit"]')),
    };
  });

  await page.screenshot({ path: path.join(out, "01-lab-dialkit-2x.png") });
  report.shots.push("01-lab-dialkit-2x.png");

  // Export code opens the dialog with the generated code
  await page.locator(".dialkit-panel button", { hasText: "Export code" }).click();
  await sleep(200);
  report.dialkitAttribution.exportDrawerWorks = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    const text = dialog.textContent ?? "";
    return text.includes("<GlassStage");
  });
  await page.getByRole("button", { name: "Close" }).click();
  await sleep(150);

  // Tier 0: parked loupe and merged orb
  const activeLabEngine = await page.evaluate(
    () => document.querySelector("[data-lab-engine]")?.getAttribute("data-lab-engine") ?? null,
  );
  await page.keyboard.press("p"); // park loupe
  await sleep(450);
  await page.keyboard.press("m"); // merge the orb
  await sleep(600);
  await page.keyboard.press("h"); // hide the controls
  await sleep(250);

  const tier0Rect = await page.evaluate(() => {
    const r = document.querySelector(".lab-chrome-dock")?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.max(0, Math.floor(r.left - 36)),
      y: Math.max(0, Math.floor(r.top - 32)),
      width: Math.min(1440, Math.ceil(r.width + 72)),
      height: Math.min(900, Math.ceil(r.height + 64)),
    };
  });
  let shotTier0Kit = null;
  if (tier0Rect) {
    shotTier0Kit = await page.screenshot({
      path: path.join(out, "02-tier0-hic-smin-2x.png"),
      clip: tier0Rect,
    });
    report.shots.push("02-tier0-hic-smin-2x.png");
  }

  // Check the neck between bar and orb for a pinch
  const saddleMetrics = await page.evaluate(async () => {
    const bar = document.querySelector(".lgw-tabbar")?.getBoundingClientRect();
    const orb = document.querySelector(".lgw-orb")?.getBoundingClientRect();
    if (!bar || !orb) return null;
    return {
      gapPx: +(orb.left - bar.right).toFixed(2),
      neckX: +((bar.right + orb.left) / 2).toFixed(2),
      neckY: +(bar.top + bar.height / 2).toFixed(2),
    };
  });

  let saddlePinchScore = null;
  if (saddleMetrics) {
    const neckBuf = await page.screenshot({
      clip: {
        x: Math.max(0, Math.floor(saddleMetrics.neckX - 8)),
        y: Math.max(0, Math.floor(saddleMetrics.neckY - 8)),
        width: 16,
        height: 16,
      },
    });
    const { width, height, rgba } = await readPixels(page, neckBuf);
    // Largest bright/dark spike at the saddle center vs a 4px ring around it
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const lumaAt = (x, y) => {
      const k = (y * width + x) * 4;
      return 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
    };
    const centerLuma = lumaAt(cx, cy);
    let ringSum = 0;
    let ringN = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (Math.hypot(dx, dy) >= 3 && Math.hypot(dx, dy) <= 4.5) {
          ringSum += lumaAt(cx + dx, cy + dy);
          ringN++;
        }
      }
    }
    const ringMean = ringSum / Math.max(1, ringN);
    saddlePinchScore = +Math.abs(centerLuma - ringMean).toFixed(1);
  }

  report.tier0 = {
    engine: activeLabEngine,
    fusedGapPx: saddleMetrics?.gapPx ?? null,
    saddleCenterDeltaLuma: saddlePinchScore,
  };

  // 3. Tier 1 probes (/lab?engine=svg-backdrop)
  await page.goto(`${base}/lab?engine=svg-backdrop&paused=1&parked=1`, {
    waitUntil: "networkidle",
  });
  await sleep(900);
  await page.keyboard.press("h");
  await sleep(220);

  report.tier1.domState = await page.evaluate(() => {
    const inspect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const id = /#([\w-]+)/.exec(el.style.getPropertyValue("--lgw-lens-url"))?.[1];
      const filter = id ? document.getElementById(id) : null;
      return {
        rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
        backdropFilter: cs.backdropFilter,
        filter: filter && {
          id,
          displacementMaps: filter.querySelectorAll("feDisplacementMap").length,
          scales: [...filter.querySelectorAll("feDisplacementMap")].map(
            (m) => +Number(m.getAttribute("scale")).toFixed(3),
          ),
        },
      };
    };
    return {
      refract: document.documentElement.hasAttribute("data-lg-refract"),
      bar: inspect(".lgw-tabbar"),
      loupe: inspect(".lgw-loupe"),
    };
  });

  const cropWrap = async (name) => {
    const rect = await page.evaluate(() => {
      const r = document.querySelector(".lgw-tabbar-wrap").getBoundingClientRect();
      return {
        x: Math.max(0, r.left - 32),
        y: Math.max(0, r.top - 42),
        width: r.width + 64,
        height: r.height + 84,
      };
    });
    const buf = await page.screenshot({ path: path.join(out, name), clip: rect });
    report.shots.push(name);
    return buf;
  };

  const shotPlasmaParked = await cropWrap("03-tier1-plasma-parked-2x.png");

  const loupeBox = await page.evaluate(() => {
    const r = document.querySelector(".lgw-loupe")?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  });

  if (loupeBox) {
    // Neutral sheet behind the chrome for edge and center probes
    await page.evaluate(() => {
      const sheet = document.createElement("div");
      sheet.id = "diag-neutral-bg";
      Object.assign(sheet.style, {
        position: "fixed",
        inset: "0",
        background: "#0c121a",
        zIndex: "50",
        pointerEvents: "none",
      });
      document.body.append(sheet);
    });
    await sleep(180);

    const maxChromaDiff = async (buf) => {
      const { rgba } = await readPixels(page, buf);
      let worst = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const d = Math.max(
          Math.abs(rgba[i] - rgba[i + 1]),
          Math.abs(rgba[i + 1] - rgba[i + 2]),
          Math.abs(rgba[i] - rgba[i + 2]),
        );
        if (d > worst) worst = d;
      }
      return worst;
    };

    const topStrip = await page.screenshot({
      clip: { x: loupeBox.x + 28, y: loupeBox.y, width: loupeBox.width - 56, height: 6 },
    });
    const botStrip = await page.screenshot({
      clip: {
        x: loupeBox.x + 28,
        y: loupeBox.y + loupeBox.height - 6,
        width: loupeBox.width - 56,
        height: 6,
      },
    });
    report.tier1.outerEdgeGlitch = {
      topStripMaxRgbSpread: await maxChromaDiff(topStrip),
      bottomStripMaxRgbSpread: await maxChromaDiff(botStrip),
      passThreshold: 18,
    };

    // Text inside the flat interior is undistorted
    const centerClip = {
      x: Math.round(loupeBox.x + 22),
      y: Math.round(loupeBox.y + 18),
      width: Math.max(10, Math.round(loupeBox.width - 44)),
      height: Math.max(10, Math.round(loupeBox.height - 36)),
    };
    const centerFull = await page.screenshot({ clip: centerClip });
    const savedScales = await page.evaluate(() => {
      const el = document.querySelector(".lgw-loupe");
      const id = /#([\w-]+)/.exec(el?.style.getPropertyValue("--lgw-lens-url") ?? "")?.[1];
      const filter = id ? document.getElementById(id) : null;
      if (!filter) return [];
      const maps = [...filter.querySelectorAll("feDisplacementMap")];
      const prev = maps.map((m) => m.getAttribute("scale"));
      maps.forEach((m) => m.setAttribute("scale", "0"));
      return prev;
    });
    await sleep(160);
    const centerFlat = await page.screenshot({ clip: centerClip });
    await page.evaluate((prev) => {
      const el = document.querySelector(".lgw-loupe");
      const id = /#([\w-]+)/.exec(el?.style.getPropertyValue("--lgw-lens-url") ?? "")?.[1];
      const filter = id ? document.getElementById(id) : null;
      if (!filter) return;
      [...filter.querySelectorAll("feDisplacementMap")].forEach((m, i) => {
        if (prev[i] != null) m.setAttribute("scale", prev[i]);
      });
    }, savedScales);
    await sleep(160);
    report.tier1.centerTextPurity = await pixelDiff(page, centerFull, centerFlat);

    // White and mid-grey stay accurate inside the loupe
    const checkFlatColor = async (hex, expectedRgb) => {
      await page.evaluate((color) => {
        const bg = document.getElementById("diag-neutral-bg");
        if (bg) bg.style.background = color;
        document.querySelector(".lgw-tabbar").style.visibility = "hidden";
        const l = document.querySelector(".lgw-loupe");
        l.dataset.prevBody = l.style.getPropertyValue("--lgw-body-color");
        l.dataset.prevBf = l.style.getPropertyValue("--lgw-backdrop");
        const id = /#([\w-]+)/.exec(l.style.getPropertyValue("--lgw-lens-url"))?.[1];
        l.style.setProperty("--lgw-body-color", "transparent");
        l.style.setProperty("--lgw-backdrop", `url(#${id})`);
      }, hex);
      await sleep(180);
      const sampleBuf = await page.screenshot({
        clip: {
          x: loupeBox.x + loupeBox.width / 2 - 6,
          y: loupeBox.y + loupeBox.height / 2 - 6,
          width: 12,
          height: 12,
        },
      });
      await page.evaluate(() => {
        document.querySelector(".lgw-tabbar").style.visibility = "";
        const l = document.querySelector(".lgw-loupe");
        l.style.setProperty("--lgw-body-color", l.dataset.prevBody);
        l.style.setProperty("--lgw-backdrop", l.dataset.prevBf);
      });
      const { rgba } = await readPixels(page, sampleBuf);
      let r = 0,
        g = 0,
        b = 0;
      const n = rgba.length / 4;
      for (let i = 0; i < rgba.length; i += 4) {
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
      }
      const mean = [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)];
      const maxErr = Math.max(...mean.map((v, idx) => Math.abs(v - expectedRgb[idx])));
      return { expected: expectedRgb, actual: mean, maxErr: +maxErr.toFixed(1) };
    };

    report.tier1.whiteAccuracy = {
      white: await checkFlatColor("#ffffff", [255, 255, 255]),
      midGrey: await checkFlatColor("#808080", [128, 128, 128]),
    };

    // Ruler bend, straight-run shear and fold check
    const measureRulerBow = async (selector, ruleOffsetY, sampleFracX, shearFracX, hideBar = false) => {
      const info = await page.evaluate(
        ({ sel, off, sfx, hide }) => {
          const bg = document.getElementById("diag-neutral-bg");
          if (bg) bg.style.background = "#ffffff";
          document.getElementById("diag-ruler-lines")?.remove();
          document.querySelector(".lgw-tabbar").style.visibility = hide ? "hidden" : "";
          const el = document.querySelector(sel);
          const r = el.getBoundingClientRect();
          const id = /#([\w-]+)/.exec(el.style.getPropertyValue("--lgw-lens-url") ?? "")?.[1];
          const layer = document.createElement("div");
          layer.id = "diag-ruler-lines";
          Object.assign(layer.style, {
            position: "fixed",
            inset: "0",
            zIndex: "51",
            pointerEvents: "none",
          });
          const add = (x, y, w, h) => {
            const d = document.createElement("div");
            Object.assign(d.style, {
              position: "absolute",
              left: `${x}px`,
              top: `${y}px`,
              width: `${w}px`,
              height: `${h}px`,
              background: "#111318",
            });
            layer.append(d);
          };
          add(0, Math.round(r.top) + off, innerWidth, 2);
          add(Math.round(r.left + r.width * sfx), 0, 2, innerHeight);
          document.body.append(layer);
          return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, id };
        },
        { sel: selector, off: ruleOffsetY, sfx: shearFracX, hide: hideBar },
      );
      if (!info.id) return null;
      await sleep(180);
      const stripClip = {
        x: Math.round(info.rect.x + info.rect.w * sampleFracX) - 10,
        y: info.rect.y,
        width: 20,
        height: 22,
      };
      const shearClip = {
        x: Math.round(info.rect.x + info.rect.w * shearFracX) - 8,
        y: Math.round(info.rect.y + 1),
        width: 16,
        height: 5,
      };
      const fullShot = await page.screenshot({ clip: stripClip });
      const shearFull = await page.screenshot({ clip: shearClip });
      const prev = await page.evaluate((id) => {
        const maps = [...document.getElementById(id).querySelectorAll("feDisplacementMap")];
        const p = maps.map((m) => m.getAttribute("scale"));
        maps.forEach((m) => m.setAttribute("scale", "0"));
        return p;
      }, info.id);
      await sleep(160);
      const flatShot = await page.screenshot({ clip: stripClip });
      const shearFlat = await page.screenshot({ clip: shearClip });
      await page.evaluate(
        ({ id, p }) => {
          [...document.getElementById(id).querySelectorAll("feDisplacementMap")].forEach((m, i) =>
            m.setAttribute("scale", p[i]),
          );
          document.querySelector(".lgw-tabbar").style.visibility = "";
        },
        { id: info.id, p: prev },
      );
      await sleep(160);
      const traceVertical = async (buf) => {
        const { width, height, rgba } = await readPixels(page, buf);
        const col = Math.floor(width / 2);
        let num = 0,
          den = 0,
          runs = 0,
          inDark = false;
        for (let y = 0; y < height; y++) {
          const k = (y * width + col) * 4;
          const lum = 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
          const dark = Math.max(0, 210 - lum);
          if (dark > 24) {
            num += (y / 2) * dark;
            den += dark;
            if (!inDark) {
              runs++;
              inDark = true;
            }
          } else {
            inDark = false;
          }
        }
        return { y: den > 0 ? +(num / den).toFixed(2) : null, runs };
      };
      const centroidX = async (buf) => {
        const { width, height, rgba } = await readPixels(page, buf);
        const row = Math.floor(height / 2);
        let num = 0,
          den = 0;
        for (let x = 0; x < width; x++) {
          const k = (row * width + x) * 4;
          const lum = 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
          const dark = Math.max(0, 210 - lum);
          if (dark > 24) {
            num += (x / 2) * dark;
            den += dark;
          }
        }
        return den > 0 ? +(num / den).toFixed(2) : null;
      };
      const tFull = await traceVertical(fullShot);
      const tFlat = await traceVertical(flatShot);
      const xFull = await centroidX(shearFull);
      const xFlat = await centroidX(shearFlat);
      return {
        bowPx: tFull.y !== null && tFlat.y !== null ? +(tFlat.y - tFull.y).toFixed(2) : null,
        sliverRuns: tFull.runs,
        straightShearPx: xFull !== null && xFlat !== null ? +(xFull - xFlat).toFixed(2) : null,
      };
    };

    report.tier1.rulerProbe.bar2x = await measureRulerBow(".lgw-tabbar", 9, 0.54, 0.72, false);
    report.tier1.rulerProbe.loupe2x = await measureRulerBow(".lgw-loupe", 10, 0.38, 0.56, true);

    await page.evaluate(() => {
      document.getElementById("diag-neutral-bg")?.remove();
      document.getElementById("diag-ruler-lines")?.remove();
    });
    await sleep(150);
  }

  // Unpark, capture the resting plasma, and confirm no bakes during gestures
  await page.keyboard.press("p");
  await sleep(450);
  const shotPlasmaResting = await cropWrap("04-tier1-plasma-resting-2x.png");

  await page.evaluate(() => {
    window.__lgwBakeCalls = 0;
    const orig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      window.__lgwBakeCalls++;
      return orig.apply(this, args);
    };
  });
  const tabCenters = await page.evaluate(() =>
    [...document.querySelectorAll(".lgw-tab")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }),
  );
  if (tabCenters.length === 4) {
    await page.mouse.move(tabCenters[0].x, tabCenters[0].y);
    await page.mouse.down();
    await sleep(120);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const x = tabCenters[0].x + (tabCenters[3].x - tabCenters[0].x) * t;
      await page.mouse.move(x, tabCenters[0].y);
      await sleep(20);
    }
    await page.mouse.up();
    await sleep(350);
  }
  report.tier1.gestureBakes = await page.evaluate(() => window.__lgwBakeCalls ?? -1);

  // 4. Tier 1 tab-switch frame timing with the plasma running
  await page.goto(`${base}/lab?engine=svg-backdrop`, { waitUntil: "networkidle" });
  await sleep(700);
  report.tier1.tabSwitchPerf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const tabs = [...document.querySelectorAll(".lgw-tab")];
        const loupe = document.querySelector(".lgw-loupe");
        if (tabs.length < 4 || !loupe) {
          resolve({ totalFrames: 0, visibleLoupeFrames: 0, maxFrameMs: 999 });
          return;
        }
        const deltas = [];
        let visibleLoupeFrames = 0;
        let last = performance.now();
        const start = last;
        tabs[3].click();
        const step = (now) => {
          deltas.push(now - last);
          last = now;
          const op = Number.parseFloat(getComputedStyle(loupe).opacity || "0");
          if (op > 0.08) visibleLoupeFrames++;
          if (now - start < 720) {
            requestAnimationFrame(step);
          } else {
            const maxFrameMs = Math.max(...deltas);
            const avgFrameMs = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
            resolve({
              totalFrames: deltas.length,
              visibleLoupeFrames,
              maxFrameMs: +maxFrameMs.toFixed(1),
              avgFrameMs: +avgFrameMs.toFixed(1),
            });
          }
        };
        requestAnimationFrame(step);
      }),
  );

  // 5. Daylight feed contrast (>= 4.5:1) and bar/orb tint parity
  await page.goto(`${base}/lab?engine=svg-backdrop&backdrop=feed&variant=tinted`, {
    waitUntil: "networkidle",
  });
  await sleep(1000);
  report.tier1.daylightFeed = await page.evaluate(() => {
    const stage = document.querySelector("[data-lgw-tier]");
    const root = document.querySelector("[data-lab-contrast]");
    const bar = document.querySelector(".lgw-tabbar");
    const orb = document.querySelector(".lgw-orb");
    const barBeforeBg = bar ? getComputedStyle(bar, "::before").backgroundColor : null;
    const orbBeforeBg = orb ? getComputedStyle(orb, "::before").backgroundColor : null;
    const contrastVal = Number.parseFloat(root?.getAttribute("data-lab-contrast") || "0");
    return {
      fg: stage?.getAttribute("data-fg") ?? null,
      worstContrast: contrastVal,
      barBeforeBg,
      orbBeforeBg,
      tintParity: Boolean(barBeforeBg && orbBeforeBg && barBeforeBg === orbBeforeBg),
    };
  });
  await page.keyboard.press("h");
  await sleep(220);
  const shotDaylightFeed = await cropWrap("05-daylight-feed-2x.png");

  // 6. Tier 2 and the optics grid
  await page.goto(`${base}/lab?engine=svg-content&backdrop=ribbon&parked=1`, {
    waitUntil: "networkidle",
  });
  await sleep(900);
  report.tier2Aave = await page.evaluate(() => {
    const loupe = document.querySelector(".lgw-loupe");
    const id = /#([\w-]+)/.exec(loupe?.style.getPropertyValue("--lgw-content-filter") ?? "")?.[1];
    const filter = id ? document.getElementById(id) : null;
    return {
      filterId: id ?? null,
      displacementBands: filter ? filter.querySelectorAll("feDisplacementMap").length : 0,
      hasGhostBar: Boolean(document.querySelector(".lgw-loupe__ghost-bar")),
    };
  });
  await page.keyboard.press("h");
  await sleep(220);
  const shotRibbonAave = await cropWrap("06-tier2-aave-ribbon-2x.png");

  await page.goto(`${base}/lab?engine=svg-backdrop&backdrop=grid&parked=1&profile=c2squircle`, {
    waitUntil: "networkidle",
  });
  await sleep(800);
  await page.keyboard.press("h");
  await sleep(200);
  const shotGridC2 = await cropWrap("07-c2squircle-grid-2x.png");

  const sheetRows = [
    {
      title: "Tier 1 Plasma (circle) · parked loupe | resting bar",
      buffers: [shotPlasmaParked, shotPlasmaResting],
    },
    {
      title: "Daylight Feed (WCAG AA + tint parity) | Tier 2 Aave 5-Band Ribbon",
      buffers: [shotDaylightFeed, shotRibbonAave],
    },
    {
      title: "C² Squircle Optics Grid",
      buffers: [shotGridC2],
    },
  ];
  if (shotTier0Kit) {
    sheetRows.unshift({
      title: "Tier 0 HTML-in-Canvas WebGL2 · parked loupe + smin fused Search Orb",
      buffers: [shotTier0Kit],
    });
  }
  await saveContactSheet(page, sheetRows, path.join(out, "contact-sheet.png"));
  report.shots.push("contact-sheet.png");
  await ctx.close();

  // 7. Fresnel luminance rows at 1x, 1.25x, 1.5x, 2x
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const fCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: dpr,
      reducedMotion: "no-preference",
    });
    const fPage = await fCtx.newPage();
    fPage.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("ERR_NAME_NOT_RESOLVED")) {
        report.errors.push(`@${dpr}x: ${m.text()}`);
      }
    });
    fPage.on("pageerror", (e) => report.errors.push(`@${dpr}x: ${String(e)}`));

    await fPage.goto(`${base}/lab?engine=svg-backdrop&paused=1`, { waitUntil: "networkidle" });
    await sleep(850);
    await fPage.keyboard.press("h");
    await fPage.evaluate(() => {
      const sheet = document.createElement("div");
      Object.assign(sheet.style, {
        position: "fixed",
        inset: "0",
        background: "#0a1218",
        zIndex: "50",
        pointerEvents: "none",
      });
      document.body.append(sheet);
    });
    await sleep(200);
    const barRect = await fPage.evaluate(() => {
      const r = document.querySelector(".lgw-tabbar").getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const sliceBuf = await fPage.screenshot({
      clip: { x: barRect.x + barRect.w * 0.65, y: barRect.y, width: 6, height: 10 },
    });
    const { width, height, rgba } = await readPixels(fPage, sliceBuf);
    const col = Math.floor(width / 2);
    const bgLum = 0.2126 * 10 + 0.7152 * 18 + 0.0722 * 24;
    const rows = [];
    for (let cssY = 0; cssY < 6; cssY++) {
      const y0 = Math.min(height - 1, Math.floor(cssY * dpr));
      const y1 = Math.min(height, Math.max(y0 + 1, Math.round((cssY + 1) * dpr)));
      let sumLum = 0;
      for (let devY = y0; devY < y1; devY++) {
        const k = (devY * width + col) * 4;
        sumLum += 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
      }
      rows.push(+(sumLum / (y1 - y0) - bgLum).toFixed(1));
    }
    report.rimProfiles[`${dpr}x`] = rows;
    await fCtx.close();
  }
} finally {
  await browser.close();
}

const rimMonotonic = Object.values(report.rimProfiles).every(
  (rows) => rows.length >= 4 && rows[0] > rows[1] && rows[1] > rows[2] && rows[2] > rows[3],
);

report.gates = {
  zeroConsoleErrors: report.errors.length === 0,
  dialkitAttributed: Boolean(
    report.dialkitAttribution?.mentionsDialKit &&
      report.dialkitAttribution?.mentionsJoshPuckett &&
      report.dialkitAttribution?.exportDrawerWorks,
  ),
  centerTextPurityZero: report.tier1.centerTextPurity?.max === 0,
  whiteAndGreyZeroError:
    report.tier1.whiteAccuracy?.white?.maxErr === 0 &&
    report.tier1.whiteAccuracy?.midGrey?.maxErr === 0,
  outerEdgeGlitchPass:
    (report.tier1.outerEdgeGlitch?.topStripMaxRgbSpread ?? 999) <= 18 &&
    (report.tier1.outerEdgeGlitch?.bottomStripMaxRgbSpread ?? 999) <= 18,
  monotonicFresnelAcrossDprs: rimMonotonic,
  zeroGestureBakes: report.tier1.gestureBakes === 0,
  tier1TabSwitchFast:
    (report.tier1.tabSwitchPerf?.maxFrameMs ?? 999) < 100 &&
    (report.tier1.tabSwitchPerf?.visibleLoupeFrames ?? 0) >= 20,
  daylightWcagAndTintParity:
    report.tier1.daylightFeed?.fg === "dark" &&
    (report.tier1.daylightFeed?.worstContrast ?? 0) >= 4.5 &&
    Boolean(report.tier1.daylightFeed?.tintParity),
  tier2AaveFiveBands:
    report.tier2Aave?.displacementBands === 5 && Boolean(report.tier2Aave?.hasGhostBar),
};

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failed = Object.entries(report.gates)
  .filter(([, ok]) => !ok)
  .map(([k]) => k);
if (failed.length > 0) {
  console.error("FAILED GATES:", failed.join(", "));
  process.exit(1);
}
