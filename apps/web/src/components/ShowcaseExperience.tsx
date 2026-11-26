"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  GlassButton,
  GlassContainer,
  GlassOrb,
  GlassSlider,
  GlassStage,
  GlassSwitch,
  GlassTabBar,
  type GlassShapeProfile,
  type GlassTabBarDiagnostics,
  type GlassTabItem,
  type GlassVariant,
  type ResolvedGlassTier,
} from "liquid-glass-web";
import {
  CodeIcon,
  HeartIcon,
  HomeIcon,
  LayersIcon,
  SearchIcon,
  SlidersIcon,
} from "./Icons";
import { FEED_CARDS } from "./LabBackdrops";

const TIER_LABELS: Record<ResolvedGlassTier, string> = {
  "html-in-canvas": "Tier 0 · HTML-in-Canvas WebGL2",
  "svg-backdrop": "Tier 1 · Chromium SVG Backdrop",
  "svg-content": "Tier 2 · Aave Content-Path",
  frost: "Tier 3 · Accessible Frost",
};

const QUICKSTART_SNIPPET = `import {
  GlassStage,
  GlassContainer,
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
} from "liquid-glass-web";
import "liquid-glass-web/styles.css";

<GlassStage engine="auto">
  <YourScrollablePageContent />

  <GlassStage.Chrome>
    <GlassContainer id="nav" mergeRadius={22}>
      <GlassTabBar
        variant="regular"
        interactive
        adaptiveContrast
        items={tabs}
        value={activeTab}
        onChange={setActiveTab}
      />
      <GlassOrb
        merged={orbFused}
        onClick={() => setOrbFused((v) => !v)}
        aria-label="Search"
      >
        <SearchIcon />
      </GlassOrb>
    </GlassContainer>

    <GlassSwitch checked={enabled} onCheckedChange={setEnabled} />
    <GlassSlider value={level} onValueChange={setLevel} />
  </GlassStage.Chrome>
</GlassStage>`;

export function ShowcaseExperience() {
  const [activeTab, setActiveTab] = useState("overview");
  const [variant, setVariant] = useState<GlassVariant>("regular");
  const [profile, setProfile] = useState<GlassShapeProfile>("circle");
  const [orbFused, setOrbFused] = useState(false);
  const [switchEnabled, setSwitchEnabled] = useState(true);
  const [sliderLevel, setSliderLevel] = useState(0.64);
  const [tier, setTier] = useState<ResolvedGlassTier>("svg-backdrop");
  const [diag, setDiag] = useState<GlassTabBarDiagnostics | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);

  const tabs = useMemo<readonly GlassTabItem[]>(
    () => [
      {
        id: "overview",
        label: "Overview",
        icon: (active) => <HomeIcon size={20} filled={active} />,
      },
      {
        id: "controls",
        label: "Controls",
        icon: () => <SlidersIcon size={20} />,
      },
      {
        id: "engines",
        label: "Engines",
        icon: (active) => <LayersIcon size={20} filled={active} />,
      },
      {
        id: "saved",
        label: "Install",
        icon: (active) => <HeartIcon size={20} filled={active} />,
      },
    ],
    [],
  );

  const handleSelectTab = (id: string) => {
    setActiveTab(id);
    const target = document.getElementById(`section-${id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText("npm install liquid-glass-web motion");
      setCopiedInstall(true);
      window.setTimeout(() => setCopiedInstall(false), 1800);
    } catch {
      setCopiedInstall(false);
    }
  };

  return (
    <GlassStage
      engine="auto"
      variant={variant}
      shapeProfile={profile}
      interactive
      adaptiveContrast
      onTierChange={setTier}
    >
      <main className="sc-page">
        {/* Hero */}
        <section id="section-overview" className="sc-hero" data-lgw-bg-samples="7,11,18;16,58,64;118,74,24">
          <div className="sc-container">
            <header className="sc-topbar">
              <div className="sc-brand">
                <span className="sc-brand__dot" aria-hidden="true" />
                <span>liquid-glass-web</span>
              </div>
              <nav className="sc-nav-links" aria-label="Primary links">
                <Link href="/lab" className="sc-pill-link sc-pill-link--primary">
                  Open Material Lab
                </Link>
                <a
                  href="https://github.com/pavlonekrasov/liquid-glass-web"
                  target="_blank"
                  rel="noreferrer"
                  className="sc-pill-link"
                >
                  GitHub
                </a>
              </nav>
            </header>

            <div className="sc-hero__eyebrow">
              <span className="sc-hero__tier-dot" aria-hidden="true" />
              <span>{TIER_LABELS[tier]}</span>
              {diag?.legibility && (
                <span>· WCAG {diag.legibility.worstContrast.toFixed(1)}:1 AA</span>
              )}
            </div>

            <h1 className="sc-hero__title">Physically grounded Liquid Glass for the web.</h1>
            <p className="sc-hero__lead">
              An open-source Apple iOS 26/27 material and component system built on real{" "}
              <code>h(0) = 0</code> Snell refraction, 11-band Cauchy dispersion, 3D bezel-normal
              dual-bounce Schlick Fresnel, smooth-min liquid meniscus fusion, and automatic 4-tier
              progressive enhancement.
            </p>

            <div className="sc-hero__actions">
              <Link href="/lab" className="sc-pill-link sc-pill-link--primary">
                Launch DialKit Material Lab
              </Link>
              <button type="button" className="sc-install-cmd" onClick={copyInstall}>
                <span>npm install liquid-glass-web motion</span>
                <span className="sc-install-cmd__badge">{copiedInstall ? "Copied" : "Copy"}</span>
              </button>
            </div>

            <div id="section-controls" className="sc-quick-controls">
              <div className="sc-control-label">
                <span>Variant</span>
                <div className="sc-seg-group" role="group" aria-label="Material variant">
                  {(["regular", "clear", "tinted"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`sc-seg-btn${variant === v ? " is-active" : ""}`}
                      onClick={() => setVariant(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sc-control-label">
                <span>Profile</span>
                <div className="sc-seg-group" role="group" aria-label="Bezel curvature profile">
                  {(["circle", "c2squircle", "squircle"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`sc-seg-btn${profile === p ? " is-active" : ""}`}
                      onClick={() => setProfile(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sc-control-label">
                <span>Meniscus</span>
                <button
                  type="button"
                  className={`sc-seg-btn${orbFused ? " is-active" : ""}`}
                  style={{ border: "1px solid rgb(255 255 255 / 0.16)" }}
                  onClick={() => setOrbFused((v) => !v)}
                >
                  {orbFused ? "Orb Fused (smin)" : "Fuse Search Orb"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Daylight Scrollable Editorial Showcase */}
        <section className="sc-daylight">
          <div className="sc-container">
            <div className="sc-section-head">
              <p className="sc-section-kicker">Scroll Underneath · Live Optical Verification</p>
              <h2>Real glass adapts to every pixel scrolling beneath it.</h2>
              <p>
                Watch the floating Tab Bar and Search Orb shift polarity cleanly across daylight
                typography and saturated artwork while preserving ≥ 4.5:1 WCAG AA contrast, zero
                white-flash chatter, and crisp bezel refraction. Scrub across the tabs or drag the
                switch and slider below.
              </p>
            </div>

            <div
              className="lab-spectrum-strip"
              aria-hidden="true"
              style={{ marginBottom: 24 }}
              data-lgw-bg-samples="255,59,48;255,149,0;255,204,0;52,199,89;0,122,255;88,86,214;175,82,222"
            >
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>

            <div className="lab-feed__grid" style={{ marginBottom: 28 }}>
              {FEED_CARDS.map((card) => (
                <article
                  key={card.title}
                  className={`lab-card lab-card--${card.theme}`}
                  data-lgw-bg-samples={card.samples}
                >
                  <div>
                    <span className="lab-card__badge">{card.badge}</span>
                  </div>
                  <div className="lab-card__content">
                    <h3>{card.title}</h3>
                    <p>{card.subtitle}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="lab-type-test">
              <div className="lab-type-test__row">
                <span>01 · H(0) = 0 SNELL CONTINUITY</span>
                <span>02 · DUAL-BOUNCE FRESNEL</span>
                <span>03 · SWIFTUI SPRING PHYSICS</span>
              </div>
              <p className="lab-type-test__display">
                Press and scrub horizontally across the floating tab bar to lift the 96×66 px
                refracting loupe, or click the Search orb to fuse the glass meniscus via polynomial
                smooth-min.
              </p>
              <div
                className="lab-barcode"
                aria-hidden="true"
                data-lgw-bg-samples="15,17,22;255,255,255;0,122,255;255,45,85"
              />
            </div>
          </div>
        </section>

        {/* Architecture & Quickstart */}
        <section
          id="section-engines"
          className="sc-dark-section"
          data-lgw-bg-samples="9,12,20;13,18,29"
        >
          <div className="sc-container">
            <div className="sc-section-head">
              <p className="sc-section-kicker">Universal Progressive Enhancement</p>
              <h2>Four optical tiers, one ergonomic API.</h2>
              <p>
                Every component automatically negotiates the highest-fidelity GPU pipeline available
                on the visitor&apos;s browser while maintaining accessible real HTML and strict WCAG
                AA parity.
              </p>
            </div>

            <div className="sc-tier-grid">
              <article className="sc-tier-card">
                <span className="sc-tier-card__tag">TIER 0 · CHROME 157+</span>
                <h3>HTML-in-Canvas WebGL2</h3>
                <p>
                  Float32 11-band Cauchy-Snell shaders over live DOM textures, polynomial{" "}
                  <code>smin</code> meniscus fusion, 4× Fresnel, and 0 ms PNG bakes at 120 FPS.
                </p>
              </article>
              <article className="sc-tier-card">
                <span className="sc-tier-card__tag">TIER 1 · CHROMIUM</span>
                <h3>SVG Backdrop Fast-Path</h3>
                <p>
                  1-tap linear <code>feDisplacementMap</code> inside{" "}
                  <code>backdrop-filter: url()</code> with seam-free opaque-piece Fresnel &amp;
                  Beer–Lambert masks at 100+ FPS.
                </p>
              </article>
              <article className="sc-tier-card">
                <span className="sc-tier-card__tag">TIER 2 · SAFARI &amp; FIREFOX</span>
                <h3>Aave Content-Path</h3>
                <p>
                  Standard <code>filter: url(#…-cN)</code> 5-band continuous spectral refraction
                  with premultiplied coverage preservation and luminance cutouts.
                </p>
              </article>
              <article className="sc-tier-card">
                <span className="sc-tier-card__tag">TIER 3 · ACCESSIBILITY</span>
                <h3>High-Contrast &amp; Reduced Transparency</h3>
                <p>
                  Native parity for <code>prefers-reduced-motion</code>,{" "}
                  <code>prefers-reduced-transparency</code>, <code>prefers-contrast: more</code>,
                  and <code>forced-colors: active</code>.
                </p>
              </article>
            </div>

            <div id="section-saved" className="sc-section-head">
              <p className="sc-section-kicker">Developer Experience</p>
              <h2>Six semantic props out of the box.</h2>
              <p>
                Drop in <code>&lt;GlassStage&gt;</code>, group merging controls in{" "}
                <code>&lt;GlassContainer&gt;</code>, and optionally tune optical physics via{" "}
                <code>optics</code> or export live JSX from the Material Lab.
              </p>
            </div>

            <pre className="sc-code-block">
              <code>{QUICKSTART_SNIPPET}</code>
            </pre>

            <footer className="sc-credits">
              <div>
                Parameter controls in the{" "}
                <Link href="/lab">Material Lab</Link> are powered by{" "}
                <a href="https://dialkit.dev" target="_blank" rel="noreferrer">
                  DialKit
                </a>{" "}
                by{" "}
                <a href="https://github.com/joshpuckett/dialkit" target="_blank" rel="noreferrer">
                  Josh Puckett
                </a>
                .
              </div>
              <div>
                Inspired by Apple WWDC 2025 Liquid Glass &amp; Aave&apos;s cross-browser SVG
                content-path technique.
              </div>
            </footer>
          </div>
        </section>
      </main>

      <GlassStage.Chrome>
        <div className="lab-chrome-dock">
          <GlassContainer id="showcase-nav" mergeRadius={22}>
            <GlassTabBar
              variant={variant}
              shapeProfile={profile}
              interactive
              adaptiveContrast
              items={tabs}
              value={activeTab}
              onChange={handleSelectTab}
              onDiagnostics={setDiag}
            />
            <GlassOrb
              merged={orbFused}
              onClick={() => setOrbFused((v) => !v)}
              aria-label={orbFused ? "Detach search orb" : "Fuse search orb with tab bar"}
              title="Toggle smin liquid glass fusion"
            >
              <SearchIcon size={20} />
            </GlassOrb>
          </GlassContainer>

          <div className="lab-chrome-controls">
            <GlassSwitch
              checked={switchEnabled}
              onCheckedChange={setSwitchEnabled}
              aria-label="Enable Liquid Glass demo switch"
            />
            <GlassSlider
              value={sliderLevel}
              onValueChange={setSliderLevel}
              aria-label="Liquid Glass demo intensity"
            />
            <GlassButton
              size="sm"
              onClick={() => {
                window.location.href = "/lab";
              }}
            >
              <CodeIcon size={15} />
              <span>Lab</span>
            </GlassButton>
          </div>
        </div>
      </GlassStage.Chrome>
    </GlassStage>
  );
}
