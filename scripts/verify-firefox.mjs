// liquid-glass-web — Headless installed-Firefox (Gecko) multi-DPR optical & Tier 2 harness
//
// Drives real Mozilla Firefox via its built-in W3C WebDriver BiDi server
// (--headless --remote-debugging-port) using Node's native WebSocket.
//
// Usage:
//   node scripts/verify-firefox.mjs
//   BASE_URL=http://127.0.0.1:3102 node scripts/verify-firefox.mjs

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const base = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const out = path.resolve(process.env.VERIFY_OUTPUT ?? "dist/verify-firefox");
mkdirSync(out, { recursive: true });

const defaultFirefoxPaths = [
  process.env.FIREFOX_PATH,
  "C:/Program Files/Mozilla Firefox/firefox.exe",
  "C:/Program Files (x86)/Mozilla Firefox/firefox.exe",
  "/Applications/Firefox.app/Contents/MacOS/firefox",
  "/usr/bin/firefox",
].filter(Boolean);

const firefoxExe = defaultFirefoxPaths.find((p) => existsSync(p));
if (!firefoxExe) {
  console.error("Could not find installed Firefox executable. Set FIREFOX_PATH.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FirefoxBiDi {
  constructor(exePath) {
    this.exePath = exePath;
    this.port = 9400 + Math.floor(Math.random() * 400);
    this.profileDir = mkdtempSync(path.join(os.tmpdir(), "lgw-firefox-"));
    this.proc = null;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.browserVersion = null;
    this.contextId = null;
  }

  async launch() {
    this.proc = spawn(
      this.exePath,
      [
        "--headless",
        "--no-remote",
        "--profile",
        this.profileDir,
        `--remote-debugging-port=${this.port}`,
        "about:blank",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          MOZ_HEADLESS_WIDTH: "1440",
          MOZ_HEADLESS_HEIGHT: "980",
        },
      },
    );

    let wsUrl = null;
    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) wsUrl = `${match[1]}/session`;
    };
    this.proc.stdout.on("data", onData);
    this.proc.stderr.on("data", onData);

    const deadline = Date.now() + 15000;
    while (!wsUrl && Date.now() < deadline) {
      await sleep(100);
    }
    if (!wsUrl) {
      throw new Error("Timed out waiting for Firefox WebDriver BiDi endpoint");
    }

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (err) => reject(err));
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && this.pending.has(msg.id)) {
          const { method, resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.type === "error") {
            rej(new Error(`BiDi ${method} -> ${msg.error}: ${msg.message}`));
          } else {
            res(msg.result);
          }
        } else if (msg.type === "event" && msg.method === "log.entryAdded") {
          const p = msg.params;
          if (p.level === "error" && !String(p.text ?? "").includes("ERR_NAME_NOT_RESOLVED")) {
            this.consoleErrors.push(p.text || p.type || "unknown console error");
          }
        }
      });
    });

    const session = await this.send("session.new", { capabilities: {} });
    this.browserVersion = session.capabilities?.browserVersion ?? "unknown";
    console.error(`[firefox] session ready: ${this.browserVersion}`);
    await this.send("session.subscribe", { events: ["log.entryAdded"] });

    const tree = await this.send("browsingContext.getTree", {});
    this.contextId = tree.contexts[0].context;
    console.error(`[firefox] context ready: ${this.contextId} (${tree.contexts[0].url})`);
  }

  send(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BiDi ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setDpr(devicePixelRatio = 2) {
    await this.send("browsingContext.setViewport", {
      context: this.contextId,
      devicePixelRatio,
    });
  }

  async navigate(url) {
    await this.send("browsingContext.navigate", {
      context: this.contextId,
      url,
      wait: "complete",
    });
  }

  async evalJson(fnStr, arg = null) {
    const res = await this.send("script.callFunction", {
      functionDeclaration: `async (rawArg) => {
        const arg = JSON.parse(rawArg);
        const fn = (${fnStr});
        const out = await fn(arg);
        return JSON.stringify(out === undefined ? null : out);
      }`,
      arguments: [{ type: "string", value: JSON.stringify(arg) }],
      target: { context: this.contextId },
      awaitPromise: true,
      resultOwnership: "none",
    });
    if (res.type === "exception") {
      throw new Error(`Firefox script exception: ${res.exceptionDetails?.text ?? "unknown"}`);
    }
    return JSON.parse(res.result.value);
  }

  async screenshot(clip = null) {
    const params = {
      context: this.contextId,
      origin: "viewport",
    };
    if (clip) {
      params.clip = {
        type: "box",
        x: Math.max(0, Math.round(clip.x)),
        y: Math.max(0, Math.round(clip.y)),
        width: Math.max(1, Math.round(clip.width)),
        height: Math.max(1, Math.round(clip.height)),
      };
    }
    const res = await this.send("browsingContext.captureScreenshot", params);
    return Buffer.from(res.data, "base64");
  }

  async close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        await this.send("session.end", {});
        this.ws.close();
      }
    } catch {
      // ignore close errors
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    await sleep(300);
    rmSync(this.profileDir, { recursive: true, force: true });
  }
}

async function readPixels(ff, pngBuf) {
  const b64 = pngBuf.toString("base64");
  return ff.evalJson(
    `async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data: rgba, width, height } = ctx.getImageData(0, 0, img.width, img.height);
      return { width, height, rgba: Array.from(rgba) };
    }`,
    b64,
  );
}

const report = {
  base,
  browser: "firefox",
  browserVersion: null,
  when: new Date().toISOString(),
  errors: [],
  showcase: null,
  materialLab: null,
  tier2Aave: null,
  daylightFeed: null,
  interactions: null,
  rimProfiles: {},
  gates: {},
  shots: [],
};

const ff = new FirefoxBiDi(firefoxExe);

try {
  await ff.launch();
  report.browserVersion = ff.browserVersion;
  /* ---- 1. Showcase Landing (/) at 2x DPR ---------------------------------- */
  console.error("[firefox] step 1: showcase /");
  await ff.setDpr(2);
  await ff.navigate(`${base}/`);
  await sleep(1100);

  report.showcase = await ff.evalJson(`() => {
    const stage = document.querySelector('[data-lgw-tier]');
    const bar = document.querySelector('.lgw-tabbar');
    const barBefore = bar ? getComputedStyle(bar, '::before') : null;
    const barAfter = bar ? getComputedStyle(bar, '::after') : null;
    return {
      userAgent: navigator.userAgent,
      hasUserAgentData: 'userAgentData' in navigator && Boolean(navigator.userAgentData),
      hasDataLgRefract: document.documentElement.hasAttribute('data-lg-refract'),
      tier: stage?.getAttribute('data-lgw-tier') ?? null,
      fg: stage?.getAttribute('data-fg') ?? null,
      dpr: window.devicePixelRatio,
      hasTabBar: Boolean(bar),
      hasOrb: Boolean(document.querySelector('.lgw-orb')),
      hasSwitch: Boolean(document.querySelector('.lgw-switch')),
      hasSlider: Boolean(document.querySelector('.lgw-slider')),
      hasButton: Boolean(document.querySelector('.lgw-button')),
      barBackdropFilter: bar ? getComputedStyle(bar).backdropFilter : null,
      barBeforeMaskMode: barBefore?.maskMode ?? null,
      barBeforeHasMaskImage: Boolean(barBefore?.maskImage && barBefore.maskImage !== 'none'),
      barAfterMaskMode: barAfter?.maskMode ?? null,
      barAfterHasMaskImage: Boolean(barAfter?.maskImage && barAfter.maskImage !== 'none'),
      barAfterBorderImage: barAfter?.borderImageSource?.slice(0, 32) ?? null,
      barAfterBorderWidth: barAfter?.borderTopWidth ?? null,
    };
  }`);

  const shotShowcase = await ff.screenshot();
  writeFileSync(path.join(out, "ff-00-showcase-landing-2x.png"), shotShowcase);
  report.shots.push("ff-00-showcase-landing-2x.png");

  /* ---- 2. Material Lab (/lab) Auto Tier 2 + DialKit + Attribution --------- */
  await ff.navigate(`${base}/lab?backdrop=plasma&paused=1`);
  await sleep(1200);

  const labCheck = await ff.evalJson(`() => {
    const root = document.querySelector('[data-lab-engine]');
    const stage = document.querySelector('[data-lgw-tier]');
    const text = document.body.innerText;
    const dialBtn = Array.from(document.querySelectorAll('button.dialkit-button')).find((b) =>
      b.textContent?.includes('Copy JSX & Props'),
    );
    return {
      labEngine: root?.getAttribute('data-lab-engine') ?? null,
      stageTier: stage?.getAttribute('data-lgw-tier') ?? null,
      mentionsDialKit: text.includes('DialKit'),
      mentionsJoshPuckett: text.includes('Josh Puckett'),
      hasDialKitPanel: Boolean(document.querySelector('.dialkit-panel')),
      hasDialActionBtn: Boolean(dialBtn),
    };
  }`);

  const shotLab = await ff.screenshot();
  writeFileSync(path.join(out, "ff-01-lab-plasma-2x.png"), shotLab);
  report.shots.push("ff-01-lab-plasma-2x.png");

  const exportDrawerWorks = await ff.evalJson(`async () => {
    const dialBtn = Array.from(document.querySelectorAll('button.dialkit-button')).find((b) =>
      b.textContent?.includes('Copy JSX & Props'),
    );
    if (!dialBtn) return false;
    dialBtn.click();
    await new Promise((r) => setTimeout(r, 250));
    const code = document.querySelector('.lab-drawer__code')?.textContent ?? '';
    const foot = document.querySelector('.lab-drawer__foot')?.textContent ?? '';
    const closeBtn = Array.from(document.querySelectorAll('.lab-drawer button')).find((b) =>
      b.textContent?.trim() === 'Close',
    );
    closeBtn?.click();
    return code.includes('<GlassStage') && foot.includes('Josh Puckett');
  }`);

  report.materialLab = { ...labCheck, exportDrawerWorks };

  /* ---- 3. Tier 2 Aave Content-Path Parked Loupe on Twisted Ribbon --------- */
  await ff.navigate(`${base}/lab?backdrop=ribbon&parked=1`);
  await sleep(1200);

  // Hide HUD via keyboard or button for clean optical inspection
  await ff.evalJson(`() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Hide HUD'),
    );
    btn?.click();
  }`);
  await sleep(300);

  const aaveDom = await ff.evalJson(`() => {
    const stage = document.querySelector('[data-lgw-tier]');
    const loupe = document.querySelector('.lgw-loupe');
    const clip = document.querySelector('.lgw-loupe__content-clip');
    const ghost = document.querySelector('.lgw-loupe__ghost-bar');
    const filter = Array.from(document.querySelectorAll('.lgw-svg-host filter')).find((f) =>
      f.id.includes('-c'),
    );
    const bar = document.querySelector('.lgw-tabbar');
    const track = document.querySelector('.lgw-tabbar__track');
    const barRect = bar?.getBoundingClientRect();
    const loupeRect = loupe?.getBoundingClientRect();
    const wrapRect = document.querySelector('.lgw-container')?.getBoundingClientRect();
    return {
      tier: stage?.getAttribute('data-lgw-tier') ?? null,
      loupeIsAaveContent: Boolean(loupe?.classList.contains('is-aave-content')),
      loupeOpacity: loupe ? Number.parseFloat(getComputedStyle(loupe).opacity) : 0,
      clipFilter: clip ? getComputedStyle(clip).filter : null,
      hasGhostBar: Boolean(ghost),
      ghostTransform: ghost ? getComputedStyle(ghost).transform : null,
      filterId: filter?.id ?? null,
      displacementBands: filter ? filter.querySelectorAll('feDisplacementMap').length : 0,
      trackMaskImage: track ? getComputedStyle(track).maskImage?.slice(0, 48) : null,
      trackMaskMode: track ? getComputedStyle(track).maskMode : null,
      wrapRect: wrapRect
        ? { x: wrapRect.left, y: wrapRect.top, w: wrapRect.width, h: wrapRect.height }
        : null,
      loupeRect: loupeRect
        ? { x: loupeRect.left, y: loupeRect.top, w: loupeRect.width, h: loupeRect.height }
        : null,
      barRect: barRect
        ? { x: barRect.left, y: barRect.top, w: barRect.width, h: barRect.height }
        : null,
    };
  }`);

  const shotRibbonFull = await ff.screenshot();
  writeFileSync(path.join(out, "ff-02-tier2-aave-ribbon-2x.png"), shotRibbonFull);
  report.shots.push("ff-02-tier2-aave-ribbon-2x.png");

  // Close-up around the bar + parked Aave content-path loupe + orb
  if (aaveDom.wrapRect) {
    const pad = 36;
    const shotRibbonCrop = await ff.screenshot({
      x: aaveDom.wrapRect.x - pad,
      y: aaveDom.wrapRect.y - pad,
      width: aaveDom.wrapRect.w + pad * 2,
      height: aaveDom.wrapRect.h + pad * 2,
    });
    writeFileSync(path.join(out, "ff-02b-tier2-loupe-closeup-2x.png"), shotRibbonCrop);
    report.shots.push("ff-02b-tier2-loupe-closeup-2x.png");
  }

  // Verify Aave spectral filter actually displaces & splits pixels in real Firefox
  let aavePixelCheck = null;
  if (aaveDom.loupeRect) {
    const withFilter = await ff.screenshot({
      x: aaveDom.loupeRect.x,
      y: aaveDom.loupeRect.y,
      width: aaveDom.loupeRect.w,
      height: aaveDom.loupeRect.h,
    });
    await ff.evalJson(`() => {
      const clip = document.querySelector('.lgw-loupe__content-clip');
      if (clip) clip.style.filter = 'none';
    }`);
    await sleep(120);
    const withoutFilter = await ff.screenshot({
      x: aaveDom.loupeRect.x,
      y: aaveDom.loupeRect.y,
      width: aaveDom.loupeRect.w,
      height: aaveDom.loupeRect.h,
    });
    const pxA = await readPixels(ff, withFilter);
    const pxB = await readPixels(ff, withoutFilter);
    let diffPixels = 0;
    let maxChDiff = 0;
    let chromaPixels = 0;
    for (let i = 0; i < pxA.rgba.length; i += 4) {
      const dr = Math.abs(pxA.rgba[i] - pxB.rgba[i]);
      const dg = Math.abs(pxA.rgba[i + 1] - pxB.rgba[i + 1]);
      const db = Math.abs(pxA.rgba[i + 2] - pxB.rgba[i + 2]);
      const m = Math.max(dr, dg, db);
      if (m > maxChDiff) maxChDiff = m;
      if (m > 8) diffPixels++;
      // Spectral dispersion creates slight channel separation near displaced glyph rims
      const spreadA =
        Math.max(pxA.rgba[i], pxA.rgba[i + 1], pxA.rgba[i + 2]) -
        Math.min(pxA.rgba[i], pxA.rgba[i + 1], pxA.rgba[i + 2]);
      const spreadB =
        Math.max(pxB.rgba[i], pxB.rgba[i + 1], pxB.rgba[i + 2]) -
        Math.min(pxB.rgba[i], pxB.rgba[i + 1], pxB.rgba[i + 2]);
      if (spreadA - spreadB > 12) chromaPixels++;
    }
    aavePixelCheck = { diffPixels, maxChDiff, chromaPixels };
  }
  report.tier2Aave = { ...aaveDom, aavePixelCheck };

  /* ---- 4. Daylight Feed WCAG AA & Tint Parity (Dark & Bright regions) ----- */
  await ff.navigate(`${base}/lab?backdrop=feed`);
  await sleep(1100);

  const feedTop = await ff.evalJson(`() => {
    const stage = document.querySelector('[data-lgw-tier]');
    const root = document.querySelector('[data-lab-contrast]');
    const bar = document.querySelector('.lgw-tabbar');
    const orb = document.querySelector('.lgw-orb');
    const barBg = bar ? getComputedStyle(bar, '::before').backgroundColor : null;
    const orbBg = orb ? getComputedStyle(orb, '::before').backgroundColor : null;
    return {
      fg: stage?.getAttribute('data-fg') ?? null,
      worstContrast: Number.parseFloat(root?.getAttribute('data-lab-contrast') ?? '0'),
      barBeforeBg: barBg,
      orbBeforeBg: orbBg,
      tintParity: Boolean(barBg && barBg === orbBg),
    };
  }`);

  // Scroll to the bright editorial prose / monochrome feed section to verify dark-ink daylight polarity
  await ff.evalJson(`async () => {
    window.scrollTo(0, 620);
    await new Promise((r) => setTimeout(r, 700));
  }`);

  const feedBright = await ff.evalJson(`() => {
    const stage = document.querySelector('[data-lgw-tier]');
    const root = document.querySelector('[data-lab-contrast]');
    const bar = document.querySelector('.lgw-tabbar');
    const orb = document.querySelector('.lgw-orb');
    const barBg = bar ? getComputedStyle(bar, '::before').backgroundColor : null;
    const orbBg = orb ? getComputedStyle(orb, '::before').backgroundColor : null;
    return {
      tier: stage?.getAttribute('data-lgw-tier') ?? null,
      fg: stage?.getAttribute('data-fg') ?? null,
      worstContrast: Number.parseFloat(root?.getAttribute('data-lab-contrast') ?? '0'),
      barBeforeBg: barBg,
      orbBeforeBg: orbBg,
      tintParity: Boolean(barBg && barBg === orbBg),
    };
  }`);

  report.daylightFeed = {
    ...feedBright,
    darkCardRegion: feedTop,
  };

  const shotDaylight = await ff.screenshot();
  writeFileSync(path.join(out, "ff-03-daylight-feed-2x.png"), shotDaylight);
  report.shots.push("ff-03-daylight-feed-2x.png");

  /* ---- 5. Interactive Controls & Tab-Switch Perf in Real Firefox ---------- */
  await ff.navigate(`${base}/lab?backdrop=plasma&paused=1`);
  await sleep(900);

  report.interactions = await ff.evalJson(`async () => {
    const tabs = Array.from(document.querySelectorAll('.lgw-tab'));
    const sw = document.querySelector('.lgw-switch');
    const orb = document.querySelector('.lgw-orb');
    const loupe = document.querySelector('.lgw-loupe');

    const swBefore = sw?.getAttribute('aria-checked');
    sw?.click();
    await new Promise((r) => setTimeout(r, 120));
    const swAfter = sw?.getAttribute('aria-checked');

    const orbBefore = orb?.getAttribute('aria-label');
    orb?.click();
    await new Promise((r) => setTimeout(r, 120));
    const orbAfter = orb?.getAttribute('aria-label');

    // Measure live tab-switch spring frames:
    // 1) coldFirstClick (includes headless SWGL one-time shader compile on fresh profile)
    // 2) warmTabSwitch (steady-state 5-band Tier 2 Aave animation performance)
    const measureClick = async (tabEl) => {
      const dts = [];
      let visibleLoupeFrames = 0;
      let last = performance.now();
      const start = last;
      tabEl?.click();
      await new Promise((resolve) => {
        function tick(now) {
          dts.push(+(now - last).toFixed(1));
          last = now;
          const op = loupe ? Number.parseFloat(getComputedStyle(loupe).opacity) : 0;
          if (op > 0.08) visibleLoupeFrames++;
          if (now - start < 750) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
      const maxFrameMs = dts.length ? +Math.max(...dts).toFixed(1) : 999;
      const avgFrameMs = dts.length
        ? +(dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(1)
        : 999;
      return { totalFrames: dts.length, visibleLoupeFrames, maxFrameMs, avgFrameMs };
    };

    const coldFirstClick = await measureClick(tabs[3]);
    const tab3Selected = tabs[3]?.getAttribute('aria-selected') === 'true';
    const warmTabSwitch = await measureClick(tabs[0]);
    const tab0Selected = tabs[0]?.getAttribute('aria-selected') === 'true';

    return {
      switchToggled: swBefore !== swAfter,
      swBefore,
      swAfter,
      orbToggled: orbBefore !== orbAfter,
      tabSelected: tab3Selected && tab0Selected,
      coldFirstClick,
      warmTabSwitch,
    };
  }`);

  /* ---- 6. C² Squircle Optics Grid at 2x DPR ------------------------------- */
  await ff.navigate(`${base}/lab?backdrop=grid&profile=c2squircle&parked=1`);
  await sleep(900);
  const shotGrid = await ff.screenshot();
  writeFileSync(path.join(out, "ff-04-c2squircle-grid-2x.png"), shotGrid);
  report.shots.push("ff-04-c2squircle-grid-2x.png");

  /* ---- 7. Fractional DPR Fresnel Top-Rim Profile (1x, 1.25x, 1.5x, 2x) ---- */
  for (const dpr of [1, 1.25, 1.5, 2]) {
    console.error(`[firefox] step 7: Fresnel rim @ ${dpr}x`);
    await ff.setDpr(dpr);
    await ff.navigate(`${base}/lab?backdrop=plasma&paused=1`);
    await sleep(900);

    const barRect = await ff.evalJson(`() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Hide HUD'),
      );
      btn?.click();
      const sheet = document.createElement('div');
      Object.assign(sheet.style, {
        position: 'fixed',
        inset: '0',
        background: '#0a1218',
        zIndex: '50',
        pointerEvents: 'none',
      });
      document.body.append(sheet);
      const r = document.querySelector('.lgw-tabbar').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, actualDpr: window.devicePixelRatio };
    }`);
    await sleep(250);

    const sliceBuf = await ff.screenshot({
      x: barRect.x + barRect.w * 0.65,
      y: barRect.y,
      width: 6,
      height: 10,
    });
    const { width, height, rgba } = await readPixels(ff, sliceBuf);
    const col = Math.floor(width / 2);
    const bgLum = 0.2126 * 10 + 0.7152 * 18 + 0.0722 * 24;
    const rows = [];
    const effDpr = height / 10;
    for (let cssY = 0; cssY < 6; cssY++) {
      const y0 = Math.min(height - 1, Math.floor(cssY * effDpr));
      const y1 = Math.min(height, Math.max(y0 + 1, Math.round((cssY + 1) * effDpr)));
      let sumLum = 0;
      for (let devY = y0; devY < y1; devY++) {
        const k = (devY * width + col) * 4;
        sumLum += 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
      }
      rows.push(+(sumLum / (y1 - y0) - bgLum).toFixed(1));
    }
    report.rimProfiles[`${dpr}x`] = { actualDpr: barRect.actualDpr, rows };
  }
} finally {
  report.errors = ff.consoleErrors;
  await ff.close();
}

const rimMonotonic = Object.values(report.rimProfiles).every(
  ({ rows }) => rows.length >= 4 && rows[0] > rows[1] && rows[1] > rows[2] && rows[2] > rows[3],
);

const rimVisible = Object.values(report.rimProfiles).every(({ rows }) => rows[0] > 40);

report.gates = {
  zeroConsoleErrors: report.errors.length === 0,
  autoNegotiatesTier2:
    report.showcase?.tier === "svg-content" &&
    report.showcase?.hasDataLgRefract === false &&
    report.materialLab?.stageTier === "svg-content",
  allFiveComponentsMounted:
    Boolean(report.showcase?.hasTabBar) &&
    Boolean(report.showcase?.hasOrb) &&
    Boolean(report.showcase?.hasSwitch) &&
    Boolean(report.showcase?.hasSlider) &&
    Boolean(report.showcase?.hasButton),
  dialkitAttributedAndExportWorks: Boolean(
    report.materialLab?.mentionsDialKit &&
      report.materialLab?.mentionsJoshPuckett &&
      report.materialLab?.hasDialKitPanel &&
      report.materialLab?.exportDrawerWorks,
  ),
  tier2AaveFiveBandsRendered:
    report.tier2Aave?.displacementBands === 5 &&
    Boolean(report.tier2Aave?.hasGhostBar) &&
    (report.tier2Aave?.aavePixelCheck?.diffPixels ?? 0) > 50,
  daylightWcagAndTintParity:
    report.daylightFeed?.fg === "dark" &&
    (report.daylightFeed?.worstContrast ?? 0) >= 4.5 &&
    Boolean(report.daylightFeed?.tintParity),
  interactionsAndTabSwitchSmooth:
    Boolean(report.interactions?.switchToggled) &&
    Boolean(report.interactions?.orbToggled) &&
    Boolean(report.interactions?.tabSelected) &&
    (report.interactions?.warmTabSwitch?.maxFrameMs ?? 999) < 100 &&
    (report.interactions?.warmTabSwitch?.visibleLoupeFrames ?? 0) >= 8,
  fresnelRimVisibleAndMonotonic: rimVisible && rimMonotonic,
};

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failed = Object.entries(report.gates)
  .filter(([, ok]) => !ok)
  .map(([k]) => k);
if (failed.length > 0) {
  console.error("FAILED FIREFOX GATES:", failed.join(", "));
  process.exit(1);
}
