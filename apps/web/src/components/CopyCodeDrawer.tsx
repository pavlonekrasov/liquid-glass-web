"use client";

import { useState } from "react";
import type {
  GlassEnginePreference,
  GlassShapeProfile,
  GlassVariant,
} from "liquid-glass-web";

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

export function generateLabJsx(c: ExportableLabConfig): string {
  const opticsLines: string[] = [];
  if (Math.abs(c.ior - 1.5168) > 0.002) opticsLines.push(`    ior: ${c.ior.toFixed(4)},`);
  if (c.bezel !== 16) opticsLines.push(`    bezel: ${c.bezel},`);
  if (c.thickness !== 22) opticsLines.push(`    thickness: ${c.thickness},`);
  if (c.tintColor.toLowerCase() !== "#0e121c") {
    opticsLines.push(`    tintColor: "${c.tintColor}",`);
  }
  if (Math.abs(c.bodyOpacity - 0.18) > 0.01) {
    opticsLines.push(`    bodyOpacity: ${c.bodyOpacity.toFixed(2)},`);
  }
  if (c.lightAngle !== -125) opticsLines.push(`    lightAngle: ${c.lightAngle},`);
  if (Math.abs(c.specular - 0.82) > 0.01) {
    opticsLines.push(`    specular: ${c.specular.toFixed(2)},`);
  }
  if (Math.abs(c.backBounce - 0.55) > 0.01) {
    opticsLines.push(`    backBounce: ${c.backBounce.toFixed(2)},`);
  }
  if (Math.abs(c.shadowStrength - 0.13) > 0.005) {
    opticsLines.push(`    shadowStrength: ${c.shadowStrength.toFixed(2)},`);
  }
  if (!c.pressCompression) opticsLines.push(`    pressCompression: false,`);

  const opticsProp =
    opticsLines.length > 0 ? `\n        optics={{\n      ${opticsLines.join("\n      ")}\n        }}` : "";

  return `import {
  GlassStage,
  GlassContainer,
  GlassTabBar,
  GlassOrb,
  GlassSwitch,
  GlassSlider,
} from "liquid-glass-web";
import "liquid-glass-web/styles.css";

export function Example() {
  return (
    <GlassStage engine="${c.engine}">
      <YourScrollablePageContent />

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
            merged={${c.fuseOrb}}
            onClick={() => setOrbFused((v) => !v)}
            aria-label="Search"
          >
            <SearchIcon />
          </GlassOrb>
        </GlassContainer>

        <GlassSwitch checked={enabled} onCheckedChange={setEnabled} />
        <GlassSlider value={level} onValueChange={setLevel} />
      </GlassStage.Chrome>
    </GlassStage>
  );
}`;
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

  if (!open) return null;

  const snippet = generateLabJsx(config);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="lab-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Copy liquid-glass-web JSX and props"
      onClick={onClose}
    >
      <div className="lab-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="lab-drawer__head">
          <h2>Copy JSX &amp; Props</h2>
          <div className="lab-drawer__actions">
            <button type="button" className="lab-chip is-active" onClick={handleCopy}>
              {copied ? "Copied" : "Copy JSX"}
            </button>
            <button type="button" className="lab-chip" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <pre className="lab-drawer__code">
          <code>{snippet}</code>
        </pre>
        <div className="lab-drawer__foot">
          Parameter controls powered by{" "}
          <a href="https://dialkit.dev" target="_blank" rel="noreferrer">
            DialKit
          </a>{" "}
          by{" "}
          <a href="https://github.com/joshpuckett/dialkit" target="_blank" rel="noreferrer">
            Josh Puckett
          </a>
          .
        </div>
      </div>
    </div>
  );
}
