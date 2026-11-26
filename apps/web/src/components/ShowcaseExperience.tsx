"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GlassContainer,
  GlassOrb,
  GlassScrollEdge,
  GlassSlider,
  GlassStage,
  GlassSwitch,
  GlassTabBar,
  type GlassTabItem,
  type GlassVariant,
  type ResolvedGlassTier,
} from "@pavlonekrasov/liquid-glass-web";
import { CodeEditor, type CodeEditorTab } from "./CodeEditor";
import { GitHubIcon, HeartIcon, HomeIcon, LayersIcon, SearchIcon } from "./Icons";
import "./ShowcaseExperience.css";

const INSTALL_CMD = "npm install @pavlonekrasov/liquid-glass-web";
const SKILL_CMD = "npx skills add pavlonekrasov/liquid-glass-web";

type StageSurface = "paper" | "navy";

/* Engine-by-browser grid. "used" is what the browser picks, "fallback" is what it can drop to. */
type TierCell = "used" | "fallback" | "no" | "asked";

const TIER_BROWSERS: readonly { readonly name: string; readonly tier: ResolvedGlassTier }[] = [
  { name: "Chrome 157+", tier: "html-in-canvas" },
  { name: "Chromium", tier: "svg-backdrop" },
  { name: "Safari", tier: "svg-content" },
  { name: "Firefox", tier: "svg-content" },
];

const TIER_CELL_TEXT: Record<TierCell, string> = {
  used: "Used",
  fallback: "Fallback",
  no: "No",
  asked: "When asked",
};

const RENDER_TIERS: readonly {
  readonly tier: ResolvedGlassTier;
  readonly index: string;
  readonly name: string;
  readonly cells: readonly [TierCell, TierCell, TierCell, TierCell];
}[] = [
  { tier: "html-in-canvas", index: "0", name: "HTML in canvas", cells: ["used", "no", "no", "no"] },
  { tier: "svg-backdrop", index: "1", name: "SVG backdrop", cells: ["fallback", "used", "no", "no"] },
  {
    tier: "svg-content",
    index: "2",
    name: "Content path",
    cells: ["fallback", "fallback", "used", "used"],
  },
  { tier: "frost", index: "3", name: "Frost", cells: ["asked", "asked", "asked", "asked"] },
];

const LAYOUT_SNIPPET = `import { CHROMIUM_REFRACT_INIT_SCRIPT } from "@pavlonekrasov/liquid-glass-web";
import "@pavlonekrasov/liquid-glass-web/styles.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHROMIUM_REFRACT_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}`;

const CORE_SNIPPET = `import { buildClampTable, cauchyIor, polySmin } from "@pavlonekrasov/liquid-glass-web/core";

const optics = buildClampTable({
  bezel: 16,
  thickness: 22,
  ior: cauchyIor(1.5168, 0.4861, 0.62), // Schott N-BK7 F-line (486.1 nm)
  profile: "circle",
  minJacobian: 0.25,
});

const bridge = polySmin(1.5, 1.5, 22);`;

function buildAppSnippet(
  variant: GlassVariant,
  orbFused: boolean,
): { code: string; highlightLines: number[] } {
  const lines = [
    `import {`,
    `  GlassStage, GlassContainer, GlassTabBar,`,
    `  GlassOrb, GlassSwitch, GlassSlider,`,
    `} from "@pavlonekrasov/liquid-glass-web";`,
    `import "@pavlonekrasov/liquid-glass-web/styles.css";`,
    ``,
    `export function App() {`,
    `  return (`,
    `    <GlassStage engine="auto">`,
    `      <PageContent />`,
    `      <GlassStage.Chrome>`,
    `        <GlassContainer id="nav" mergeRadius={22}>`,
    `          <GlassTabBar`,
    `            variant="${variant}"`,
    `            items={tabs}`,
    `            value={tab}`,
    `            onChange={setTab}`,
    `          />`,
    `          <GlassOrb merged={${orbFused}} onClick={toggleMerge}>`,
    `            <SearchIcon />`,
    `          </GlassOrb>`,
    `        </GlassContainer>`,
    `        <GlassSwitch checked={on} onCheckedChange={setOn} />`,
    `        <GlassSlider value={level} onValueChange={setLevel} />`,
    `      </GlassStage.Chrome>`,
    `    </GlassStage>`,
    `  );`,
    `}`,
  ];

  const highlightLines: number[] = [];
  if (variant !== "regular") highlightLines.push(14);
  if (orbFused) highlightLines.push(19);
  return { code: lines.join("\n"), highlightLines };
}

export function ShowcaseExperience() {
  const router = useRouter();
  const [navTab, setNavTab] = useState("home");
  const [activeTab, setActiveTab] = useState("home");
  const [variant, setVariant] = useState<GlassVariant>("regular");
  const [surface, setSurface] = useState<StageSurface>("paper");
  const [orbFused, setOrbFused] = useState(false);
  const [switchEnabled, setSwitchEnabled] = useState(true);
  const [sliderLevel, setSliderLevel] = useState(0.62);
  const [tier, setTier] = useState<ResolvedGlassTier>("svg-backdrop");
  const [paperLoaded, setPaperLoaded] = useState(false);


  const isNavy = surface === "navy";

  const navItems = useMemo<readonly GlassTabItem[]>(
    () => [
      { id: "home", label: "Home" },
      { id: "lab", label: "Lab" },
    ],
    [],
  );

  const navOptics = useMemo(
    () => ({
      foreground: "dark" as const,
      edgeRingLight: false,
      tintColor: "#faf8f4",
      bodyOpacity: 0.38,
      shadowStrength: 0.08,
    }),
    [],
  );

  const handleNavChange = (next: string) => {
    setNavTab(next);
    if (next === "home") return;
    const href = "/lab";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      router.push(href);
    } else {
      window.setTimeout(() => router.push(href), 170);
    }
  };

  const tabs = useMemo<readonly GlassTabItem[]>(
    () => [
      {
        id: "home",
        label: "Home",
        icon: (active) => <HomeIcon size={19} filled={active} />,
      },
      {
        id: "search",
        label: "Search",
        icon: () => <SearchIcon size={19} />,
      },
      {
        id: "saved",
        label: "Saved",
        icon: (active) => <HeartIcon size={19} filled={active} />,
      },
      {
        id: "library",
        label: "Library",
        icon: (active) => <LayersIcon size={19} filled={active} />,
      },
    ],
    [],
  );

  const stageOptics = useMemo(
    () =>
      isNavy
        ? {
            foreground: "light" as const,
            edgeRingLight: true,
            tintColor: "#0c1528",
            bodyOpacity: variant === "regular" ? 0.24 : undefined,
            shadowStrength: 0.14,
          }
        : {
            foreground: "dark" as const,
            edgeRingLight: false,
            tintColor: "#faf8f4",
            bodyOpacity: variant === "regular" ? 0.34 : undefined,
            shadowStrength: 0.06,
          },
    [isNavy, variant],
  );

  const editorTabs = useMemo<readonly CodeEditorTab[]>(() => {
    const app = buildAppSnippet(variant, orbFused);
    return [
      {
        id: "app",
        filename: "App.tsx",
        code: app.code,
        highlightLines: app.highlightLines,
      },
      {
        id: "layout",
        filename: "layout.tsx",
        code: LAYOUT_SNIPPET,
      },
      {
        id: "core",
        filename: "core.ts",
        code: CORE_SNIPPET,
      },
    ];
  }, [variant, orbFused]);


  return (
    <div className="pm-page">
      <a className="pm-skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="pm-shell">
        <main id="main-content">
          <header className="pm-hero">
            <div className="pm-hero__row">
              <h1 className="pm-hero__title">Liquid Glass</h1>
              <a
                href="https://github.com/pavlonekrasov/liquid-glass-web"
                target="_blank"
                rel="noreferrer"
                className="pm-github-link"
                aria-label="GitHub repository"
                title="GitHub"
              >
                <GitHubIcon size={20} />
              </a>
            </div>

            <p className="pm-hero__prose">
              React primitives built on Snell refraction, Cauchy dispersion, Schlick Fresnel, and
              SwiftUI springs.
            </p>

            <div className="pm-hero__actions">
              <Link href="/lab" className="pm-btn pm-btn--primary">
                Open Material Lab
              </Link>
            </div>
          </header>

          <section className="pm-stage-section" aria-label="Interactive Liquid Glass preview">
            <div className="pm-stage-bar">
              <div className="pm-text-tabs" role="group" aria-label="Material variant">
                {(
                  [
                    ["regular", "Regular"],
                    ["clear", "Clear"],
                    ["tinted", "Tinted"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={`pm-text-tab${variant === val ? " is-active" : ""}`}
                    aria-pressed={variant === val}
                    onClick={() => setVariant(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="pm-text-tabs" role="group" aria-label="Preview backdrop">
                {(
                  [
                    ["paper", "Paper"],
                    ["navy", "Navy"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={`pm-text-tab${surface === val ? " is-active" : ""}`}
                    aria-pressed={surface === val}
                    onClick={() => setSurface(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pm-stage-frame">
              <GlassStage
                engine="auto"
                fullscreen={false}
                variant={variant}
                interactive
                adaptiveContrast
                optics={stageOptics}
                sceneKey={`${surface}-${paperLoaded ? "1" : "0"}`}
                onTierChange={setTier}
                className="pm-stage"
              >
                <div
                  className={`pm-canvas pm-canvas--${surface}`}
                  data-lgw-bg-samples={
                    isNavy ? "12,20,38;18,30,54" : "250,248,244;245,242,236"
                  }
                >
                  {!isNavy && (
                    <img
                      src="/textures/paper-scan.jpg"
                      alt=""
                      aria-hidden="true"
                      className="pm-canvas__paper"
                      onLoad={() => setPaperLoaded(true)}
                    />
                  )}
                  <div className="pm-canvas__grid" aria-hidden="true" />
                </div>

                <GlassStage.Chrome>
                  <div className="pm-canvas-chrome">
                    <div className="pm-canvas-kit">
                      <GlassContainer id="showcase-nav" mergeRadius={22}>
                        <GlassTabBar
                          variant={variant}
                          interactive
                          adaptiveContrast
                          items={tabs}
                          value={activeTab}
                          onChange={setActiveTab}
                        />
                        <GlassOrb
                          merged={orbFused}
                          onClick={() => setOrbFused((v) => !v)}
                          aria-label={
                            orbFused ? "Detach search orb" : "Merge search orb with tab bar"
                          }
                          title="Toggle smooth-min meniscus fusion"
                        >
                          <SearchIcon size={19} />
                        </GlassOrb>
                      </GlassContainer>

                      <div className="pm-canvas-kit__row">
                        <GlassSwitch
                          checked={switchEnabled}
                          onCheckedChange={setSwitchEnabled}
                          aria-label="Enable Liquid Glass demo switch"
                        />
                        <GlassSlider
                          value={sliderLevel}
                          onValueChange={setSliderLevel}
                          aria-label="Adjust Liquid Glass demo slider"
                        />
                      </div>
                    </div>
                  </div>
                </GlassStage.Chrome>
              </GlassStage>
            </div>
          </section>

          <section className="pm-code-section" aria-label="Installation and usage">
            <div className="pm-installs">
              <InstallCommand command={INSTALL_CMD} label="package install command" />
              <InstallCommand command={SKILL_CMD} label="agent skill install command" />
            </div>

            <CodeEditor tabs={editorTabs} defaultTabId="app" ariaLabel="Library usage examples" />
          </section>

          <section className="pm-tiers-section" aria-labelledby="tiers-heading">
            <h2 className="pm-section__title" id="tiers-heading">
              How it renders
            </h2>
            <p className="pm-tiers-lead">
              Each browser gets the best engine it supports. No setup, no flags.
            </p>

            <div
              className="pm-table-wrap"
              role="region"
              aria-labelledby="tiers-heading"
              tabIndex={0}
            >
              <table className="pm-table" aria-labelledby="tiers-heading">
                <thead>
                  <tr>
                    <th scope="col" className="pm-table__lead">
                      Engine
                    </th>
                    {TIER_BROWSERS.map((browser) => {
                      const isHere = browser.tier === tier;
                      return (
                        <th
                          key={browser.name}
                          scope="col"
                          className={isHere ? "is-here" : undefined}
                        >
                          {browser.name}
                          {isHere && <span className="pm-sr-only"> (this browser)</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {RENDER_TIERS.map((row) => (
                    <tr key={row.tier}>
                      <th scope="row" className="pm-table__lead">
                        <span className="pm-table__num" aria-hidden="true">
                          {row.index}
                        </span>
                        {row.name}
                      </th>
                      {row.cells.map((cell, i) => (
                        <td key={TIER_BROWSERS[i].name} className={`is-${cell}`}>
                          {TIER_CELL_TEXT[cell]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pm-tiers-note">
              The content path is the method from Aave&apos;s{" "}
              <a
                href="https://aave.com/design/building-glass-for-the-web"
                target="_blank"
                rel="noreferrer"
                className="pm-link"
              >
                Building Glass for the Web
              </a>
              . Frost takes over when the system asks for less transparency or more contrast.
            </p>
          </section>
        </main>

        <footer className="pm-footer">
          <p>
            Made by{" "}
            <a
              href="https://www.pavlonekrasov.com"
              target="_blank"
              rel="noreferrer"
              className="pm-link"
            >
              Pavlo Nekrasov
            </a>
            .
          </p>
          <p>
            Lab controls by{" "}
            <a href="https://dialkit.dev" target="_blank" rel="noreferrer" className="pm-link">
              DialKit
            </a>{" "}
            from{" "}
            <a
              href="https://github.com/joshpuckett/dialkit"
              target="_blank"
              rel="noreferrer"
              className="pm-link"
            >
              Josh Puckett
            </a>
            .
          </p>
        </footer>
      </div>

      <GlassScrollEdge position="bottom" tintColor="var(--paper)" height={116} />

      <nav className="pm-dock" aria-label="Primary navigation">
        <GlassStage
          engine="svg-backdrop"
          fullscreen={false}
          variant="regular"
          interactive
          adaptiveContrast
          optics={navOptics}
          className="pm-dock__host"
        >
          <GlassStage.Chrome>
            <GlassTabBar
              size="text"
              variant="regular"
              interactive
              adaptiveContrast
              items={navItems}
              value={navTab}
              onChange={handleNavChange}
              aria-label="Site navigation"
              className="pm-dock__bar"
            />
          </GlassStage.Chrome>
        </GlassStage>
      </nav>
    </div>
  );
}

function InstallCommand({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="pm-install">
      <code className="pm-install__cmd">{command}</code>
      <button
        type="button"
        className={`pm-install__copy${copied ? " is-copied" : ""}`}
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
      >
        <span className="pm-install__icons pm-swap" aria-hidden="true">
          <svg
            className="pm-install__icon pm-swap__a"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
          >
            <rect
              x="9"
              y="9"
              width="11"
              height="11"
              rx="2.2"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <svg
            className="pm-install__icon pm-swap__b"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M4.5 12.75 9.5 17.75 19.5 6.75"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="pm-swap pm-swap--text" aria-hidden="true">
          <span className="pm-swap__a">Copy</span>
          <span className="pm-swap__b">Copied</span>
        </span>
      </button>
      <span className="pm-sr-only" role="status" aria-live="polite">
        {copied ? `Copied the ${label} to the clipboard.` : ""}
      </span>
    </div>
  );
}
