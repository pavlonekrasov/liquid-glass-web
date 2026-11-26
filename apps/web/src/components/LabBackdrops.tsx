"use client";

import { useEffect, useRef } from "react";

export type LabBackdropId = "plasma" | "ribbon" | "feed" | "grid" | "split";

export const FEED_CARDS = [
  {
    title: "Blue",
    subtitle: "Bright highlight on deep blue",
    theme: "alpine",
    samples: "29,62,114;43,125,233;13,27,42",
  },
  {
    title: "Neon",
    subtitle: "Pink and cyan on near-black",
    theme: "shibuya",
    samples: "11,16,38;26,11,46;255,46,147;0,229,255",
  },
  {
    title: "Citrus",
    subtitle: "Saturated stripes for color edges",
    theme: "citrus",
    samples: "255,81,47;240,152,25;255,224,0",
  },
  {
    title: "Paper",
    subtitle: "Thin ruled lines on white",
    theme: "mono",
    samples: "255,255,255;242,242,242",
  },
  {
    title: "Dusk",
    subtitle: "Soft warm gradient",
    theme: "sunset",
    samples: "44,30,90;200,75,107;255,123,84;255,154,90",
  },
  {
    title: "Moss",
    subtitle: "Dark green with a bright spot",
    theme: "emerald",
    samples: "15,81,50;7,34,27;52,232,158",
  },
] as const;

export function LiquidPlasmaBackdrop({ paused = false }: { paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 200;
    const H = 120;
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    let raf = 0;
    let t = 1.8;

    const renderFrame = (time: number) => {
      for (let y = 0; y < H; y++) {
        const ny = (y / H) * 2 - 1;
        for (let x = 0; x < W; x++) {
          const nx = ((x / W) * 2 - 1) * 1.6;
          const wx =
            nx * 1.15 +
            0.65 * Math.sin(ny * 2.9 + time * 0.42) +
            0.34 * Math.cos(nx * 2.6 - time * 0.28);
          const wy =
            ny * 1.15 +
            0.65 * Math.cos(nx * 2.7 - time * 0.36) +
            0.34 * Math.sin(ny * 3.0 + time * 0.32);

          const v1 = Math.sin(wx * 3.8 + wy * 2.4 + time * 0.22);
          const v2 = Math.cos(wx * 2.9 - wy * 3.9 - time * 0.18);
          const v3 = Math.sin(Math.hypot(wx * 1.65, wy * 1.65) * 4.1 - time * 0.3);

          const raw = (v1 + v2 + v3) / 3;
          const ridge = Math.pow(Math.max(0, Math.sin((raw + 0.16) * Math.PI)), 1.75);
          const core = Math.pow(ridge, 2.8);

          const r = Math.min(206, Math.round(6 + ridge * 162 + core * 28));
          const g = Math.min(162, Math.round(32 + ridge * 104 + core * 24));
          const b = Math.min(72, Math.round(36 + (1 - ridge) * 14 + ridge * 6));

          const idx = (y * W + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    renderFrame(t);
    const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || reducedMq.matches) return;

    let last = performance.now();
    const tick = (now: number) => {
      if (document.hidden || reducedMq.matches) {
        raf = 0;
        return;
      }
      const elapsed = now - last;
      if (elapsed >= 32) {
        last = now;
        t += Math.min(0.06, elapsed / 1000);
        renderFrame(t);
      }
      raf = requestAnimationFrame(tick);
    };

    const resume = () => {
      if (!document.hidden && !reducedMq.matches && raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", resume);
    reducedMq.addEventListener("change", resume);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", resume);
      reducedMq.removeEventListener("change", resume);
    };
  }, [paused]);

  return (
    <div className="lab-plasma" aria-hidden="true">
      <canvas ref={canvasRef} className="lab-plasma__canvas" />
      <div className="lab-plasma__vignette" />
    </div>
  );
}

export function TwistedRibbonBackdrop() {
  const strands = [
    { offset: -36, color: "#ff2a6d", width: 16, opacity: 0.95 },
    { offset: -24, color: "#ff7b29", width: 15, opacity: 0.96 },
    { offset: -12, color: "#ffd23f", width: 14, opacity: 0.98 },
    { offset: 0, color: "#3ddc97", width: 14, opacity: 0.95 },
    { offset: 12, color: "#00b4d8", width: 15, opacity: 0.95 },
    { offset: 24, color: "#7209b7", width: 16, opacity: 0.96 },
    { offset: 36, color: "#f72585", width: 14, opacity: 0.92 },
  ];

  return (
    <div
      className="lab-ribbon"
      data-lgw-bg-samples="16,12,56;76,29,149;217,119,6;255,42,109;61,220,151"
      aria-hidden="true"
    >
      <svg className="lab-ribbon__svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="lgw-ribbon-bg-1" cx="76%" cy="38%" r="58%">
            <stop offset="0%" stopColor="#d97706" stopOpacity="0.88" />
            <stop offset="48%" stopColor="#4c1d95" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#090724" stopOpacity="1" />
          </radialGradient>
          <radialGradient id="lgw-ribbon-bg-2" cx="20%" cy="22%" r="52%">
            <stop offset="0%" stopColor="#1d2b8f" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#060418" stopOpacity="0" />
          </radialGradient>
          <filter id="lgw-ribbon-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="26" stdDeviation="24" floodColor="#050311" floodOpacity="0.58" />
          </filter>
        </defs>
        <rect width="1440" height="900" fill="#090724" />
        <rect width="1440" height="900" fill="url(#lgw-ribbon-bg-1)" />
        <rect width="1440" height="900" fill="url(#lgw-ribbon-bg-2)" />
        <g filter="url(#lgw-ribbon-shadow)">
          {strands.map((s) => (
            <path
              key={s.offset}
              d={`M ${80 + s.offset * 0.4} ${940 + s.offset * 0.6}
                  C ${180 + s.offset * 0.5} ${620 + s.offset},
                    ${420 + s.offset * 0.7} ${820 + s.offset},
                    ${540 + s.offset * 0.6} ${540 + s.offset}
                  S ${760 - s.offset * 0.6} ${170 + s.offset},
                    ${860 + s.offset * 0.5} ${470 + s.offset}
                  S ${1040 + s.offset * 0.6} ${840 + s.offset},
                    ${1240 + s.offset * 0.5} ${420 + s.offset}
                  S ${1420 + s.offset * 0.4} ${140 + s.offset},
                    ${1520 + s.offset * 0.3} ${240 + s.offset}`}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              opacity={s.opacity}
            />
          ))}
          <path
            d="M 80 940 C 180 620, 420 820, 540 540 S 760 170, 860 470 S 1040 840, 1240 420 S 1420 140, 1520 240"
            fill="none"
            stroke="rgba(255,255,255,0.48)"
            strokeWidth="3"
          />
          <path
            d="M 94 958 C 194 646, 434 846, 554 566 S 774 196, 874 496 S 1054 866, 1254 446 S 1434 166, 1534 266"
            fill="none"
            stroke="rgba(0,0,0,0.34)"
            strokeWidth="4"
          />
        </g>
      </svg>
    </div>
  );
}

export function DaylightFeedBackdrop({ activeLabel }: { activeLabel: string }) {
  return (
    <div className="lab-feed">
      <section className="sc-section-head">
        <p className="sc-section-kicker">{activeLabel}</p>
        <h2>Scroll test</h2>
        <p>
          Scroll so color, type, and fine lines pass under the bar. The labels on the glass switch
          between dark and light to stay readable.
        </p>
      </section>

      <div className="lab-feed__grid">
        {FEED_CARDS.map((card) => (
          <article
            key={card.title}
            className={`lab-card lab-card--${card.theme}`}
            data-lgw-bg-samples={card.samples}
          >
            <div />
            <div className="lab-card__content">
              <h3>{card.title}</h3>
              <p>{card.subtitle}</p>
            </div>
          </article>
        ))}
      </div>

      <section className="lab-type-test">
        <p className="lab-type-test__display">
          Press a tab and drag across the bar. The lifted lens should bend this line without
          doubling it.
        </p>
        <div
          className="lab-barcode"
          aria-hidden="true"
          data-lgw-bg-samples="15,17,22;255,255,255;0,122,255;255,45,85"
        />
      </section>
    </div>
  );
}

export function OpticsGridBackdrop() {
  return (
    <div className="lab-optics-grid">
      <div className="lab-optics-grid__bands">
        <div
          className="lab-optics-band lab-optics-band--rulings"
          data-lgw-bg-samples="255,255,255;214,214,214"
        >
          <span>1 px grid</span>
        </div>
        <div
          className="lab-optics-band lab-optics-band--checker"
          data-lgw-bg-samples="24,27,34;243,244,246"
        >
          <span>Checkerboard</span>
        </div>
        <div
          className="lab-optics-band lab-optics-band--stripes"
          data-lgw-bg-samples="255,59,48;255,255,255;0,122,255;52,199,89;17,19,24"
        >
          <span>Color bars</span>
        </div>
        <div className="lab-optics-band lab-optics-band--text">
          <p>
            ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789. Straight lines should
            bow at the rim, never shear or fold.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SplitPolarityBackdrop() {
  return (
    <div className="lab-split">
      <div className="lab-split__half lab-split__half--light" data-lgw-surface-bg="true">
        <div className="lab-split__content">
          <span className="lab-split__tag">Light</span>
          <h2>On white</h2>
          <p>Labels go dark. The rim stays visible and the shadow stays soft, with no grey haze.</p>
          <div className="lab-split__bars">
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
      <div className="lab-split__half lab-split__half--dark" data-lgw-surface-bg="true">
        <div className="lab-split__content">
          <span className="lab-split__tag">Dark</span>
          <h2>On black</h2>
          <p>Labels go light. The rim catches the light on the top edge without glowing.</p>
          <div className="lab-split__bars">
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
      <div className="lab-split__ribbon" aria-hidden="true" />
    </div>
  );
}
