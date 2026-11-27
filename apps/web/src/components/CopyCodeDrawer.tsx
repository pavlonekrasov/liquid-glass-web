"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  cssColorFormat,
  parseCssColor,
  type GlassEnginePreference,
  type GlassShapeProfile,
  type GlassVariant,
} from "@pavlonekrasov/liquid-glass-web";
import "./CopyCodeDrawer.css";

export interface ExportableLabConfig {
  variant: GlassVariant;
  profile: GlassShapeProfile;
  adaptiveContrast: boolean;
  tintColor: string;
  frost: number;
  bodyOpacity: number;
  refraction: number;
  ior: number;
  bezel: number;
  thickness: number;
  loupeDispersion: number;
  lightAngle: number;
  specular: number;
  backBounce: number;
  shadowStrength: number;
  mergeRadius: number;
  fuseOrb: boolean;
  interactiveGlow: boolean;
  pressCompression: boolean;
  engine: GlassEnginePreference;
}

export type ExportLanguage = "tsx" | "jsx";

interface ExportLanguageOption {
  readonly id: ExportLanguage;
  readonly label: string;
  readonly filename: string;
}

const EXPORT_LANGUAGES: readonly ExportLanguageOption[] = [
  { id: "tsx", label: "TSX", filename: "Example.tsx" },
  { id: "jsx", label: "JSX", filename: "Example.jsx" },
];

/** The default tint written as hex is left out; any other color or syntax is exported as written. */
function isDefaultTint(tint: string): boolean {
  const parsed = parseCssColor(tint);
  if (!parsed || cssColorFormat(tint) !== "hex" || parsed.alpha < 1) return false;
  return Math.round(parsed.r) === 14 && Math.round(parsed.g) === 18 && Math.round(parsed.b) === 28;
}

export function generateLabCode(c: ExportableLabConfig, language: ExportLanguage = "tsx"): string {
  const ts = language === "tsx";

  const opticsLines: string[] = [];
  if (Math.abs(c.ior - 1.5168) > 0.002) opticsLines.push(`  ior: ${c.ior.toFixed(4)},`);
  if (c.bezel !== 16) opticsLines.push(`  bezel: ${c.bezel},`);
  if (c.thickness !== 22) opticsLines.push(`  thickness: ${c.thickness},`);
  if (!isDefaultTint(c.tintColor)) {
    opticsLines.push(`  tintColor: "${c.tintColor}",`);
  }
  if (Math.abs(c.bodyOpacity - 0.18) > 0.01) {
    opticsLines.push(`  bodyOpacity: ${c.bodyOpacity.toFixed(2)},`);
  }
  if (c.lightAngle !== -125) opticsLines.push(`  lightAngle: ${c.lightAngle},`);
  if (Math.abs(c.specular - 0.82) > 0.01) {
    opticsLines.push(`  specular: ${c.specular.toFixed(2)},`);
  }
  if (Math.abs(c.backBounce - 0.55) > 0.01) {
    opticsLines.push(`  backBounce: ${c.backBounce.toFixed(2)},`);
  }
  if (Math.abs(c.shadowStrength - 0.13) > 0.005) {
    opticsLines.push(`  shadowStrength: ${c.shadowStrength.toFixed(2)},`);
  }
  if (!c.pressCompression) opticsLines.push(`  pressCompression: false,`);
  const hasOptics = opticsLines.length > 0;

  const typeImports = hasOptics ? "GlassOpticsOverride, GlassTabItem" : "GlassTabItem";
  const imports = [
    `"use client";`,
    ``,
    `import { useState } from "react";`,
    ...(ts ? [`import type { ReactNode } from "react";`] : []),
    `import {`,
    `  GlassStage,`,
    `  GlassContainer,`,
    `  GlassTabBar,`,
    `  GlassOrb,`,
    `  GlassSwitch,`,
    `  GlassSlider,`,
    `} from "@pavlonekrasov/liquid-glass-web";`,
    ...(ts ? [`import type { ${typeImports} } from "@pavlonekrasov/liquid-glass-web";`] : []),
    `import "@pavlonekrasov/liquid-glass-web/styles.css";`,
  ].join("\n");

  const tabsDecl = `const tabs${ts ? ": readonly GlassTabItem[]" : ""} = [
  { id: "home", label: "Home" },
  { id: "browse", label: "Browse" },
  { id: "library", label: "Library" },
];`;

  const opticsDecl = hasOptics
    ? `\n\nconst optics${ts ? ": GlassOpticsOverride" : ""} = {\n${opticsLines.join("\n")}\n};`
    : "";

  const propsDecl = ts
    ? `\n\ninterface ExampleProps {
  /** Scrollable page content that the glass chrome refracts. */
  children: ReactNode;
}`
    : "";

  const state = (type: string) => (ts ? `<${type}>` : "");
  const opticsProp = hasOptics ? `\n            optics={optics}` : "";

  return `${imports}

${tabsDecl}${opticsDecl}${propsDecl}

export function Example({ children }${ts ? ": ExampleProps" : ""}) {
  const [activeTab, setActiveTab] = useState${state("string")}("home");
  const [orbFused, setOrbFused] = useState${state("boolean")}(${c.fuseOrb});
  const [enabled, setEnabled] = useState${state("boolean")}(true);
  const [level, setLevel] = useState${state("number")}(0.5);

  return (
    <GlassStage engine="${c.engine}">
      {children}

      <GlassStage.Chrome>
        <GlassContainer id="nav" mergeRadius={${c.mergeRadius}}>
          <GlassTabBar
            variant="${c.variant}"
            shapeProfile="${c.profile}"
            refraction={${c.refraction.toFixed(2)}}
            dispersion={${c.loupeDispersion.toFixed(2)}}
            frost={${c.frost.toFixed(1)}}
            interactive={${c.interactiveGlow}}
            adaptiveContrast={${c.adaptiveContrast}}${opticsProp}
            items={tabs}
            value={activeTab}
            onChange={setActiveTab}
          />
          <GlassOrb
            merged={orbFused}
            onClick={() => setOrbFused((v) => !v)}
            aria-label="Search"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </GlassOrb>
        </GlassContainer>

        <GlassSwitch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" />
        <GlassSlider value={level} onValueChange={setLevel} aria-label="Level" />
      </GlassStage.Chrome>
    </GlassStage>
  );
}
`;
}

export function CopyCodeDrawer({
  open,
  config,
  onClose,
}: {
  open: boolean;
  config: ExportableLabConfig;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState<ExportLanguage>("tsx");
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  // Move focus into the dialog, close on Escape, and hand focus back on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const activeLanguage = EXPORT_LANGUAGES.find((l) => l.id === language) ?? EXPORT_LANGUAGES[0];
  const snippet = generateLabCode(config, activeLanguage.id);

  const selectLanguage = (next: ExportLanguage) => {
    setLanguage(next);
    setCopied(false);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  };

  const handleTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = EXPORT_LANGUAGES.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % count;
    else if (e.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next === null) return;
    e.preventDefault();
    selectLanguage(EXPORT_LANGUAGES[next].id);
    tabRefs.current[next]?.focus();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="lab-drawer-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="lab-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-export-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lab-drawer__head">
          <h2 id="lab-export-title">Export code</h2>
          <div className="lab-drawer__actions">
            <button
              type="button"
              className="lab-drawer__btn lab-drawer__btn--primary"
              onClick={handleCopy}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="lab-drawer__btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="lab-drawer__bar">
          <div className="lab-drawer__tabs" role="tablist" aria-label="Language">
            {EXPORT_LANGUAGES.map((option, idx) => {
              const isSelected = option.id === activeLanguage.id;
              return (
                <button
                  key={option.id}
                  ref={(el) => {
                    tabRefs.current[idx] = el;
                  }}
                  id={`lab-export-tab-${option.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls="lab-export-code"
                  tabIndex={isSelected ? 0 : -1}
                  className={`lab-drawer__tab${isSelected ? " is-active" : ""}`}
                  onClick={() => selectLanguage(option.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <span className="lab-drawer__filename">{activeLanguage.filename}</span>
        </div>
        <pre
          id="lab-export-code"
          className="lab-drawer__code"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`lab-export-tab-${activeLanguage.id}`}
        >
          <code>{snippet}</code>
        </pre>
        <span className="sr-only" role="status" aria-live="polite">
          {copied ? "Copied to clipboard." : ""}
        </span>
      </div>
    </div>
  );
}
