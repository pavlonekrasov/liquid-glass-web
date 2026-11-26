"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import {
  GLASS_VARIANTS,
  GlassContainer,
  GlassOrb,
  GlassSlider,
  GlassStage,
  GlassSwitch,
  GlassTabBar,
  rgbToHex,
  type GlassEnginePreference,
  type GlassShapeProfile,
  type GlassTabBarDiagnostics,
  type GlassTabItem,
  type GlassVariant,
  type ResolvedGlassTier,
} from "liquid-glass-web";
import { CopyCodeDrawer, type ExportableLabConfig } from "./CopyCodeDrawer";
import {
  CodeIcon,
  HeartIcon,
  HomeIcon,
  LayersIcon,
  SearchIcon,
  SparkleIcon,
} from "./Icons";
import {
  DaylightFeedBackdrop,
  LiquidPlasmaBackdrop,
  OpticsGridBackdrop,
  SplitPolarityBackdrop,
  TwistedRibbonBackdrop,
  type LabBackdropId,
} from "./LabBackdrops";

const BACKDROP_OPTIONS: readonly { value: LabBackdropId; label: string }[] = [
  { value: "plasma", label: "Liquid Plasma" },
  { value: "ribbon", label: "Twisted Ribbon" },
  { value: "feed", label: "Daylight Feed" },
  { value: "grid", label: "Optics Grid" },
  { value: "split", label: "Light / Dark" },
];

const TIER_SHORT: Record<ResolvedGlassTier, string> = {
  "html-in-canvas": "Tier 0 · HTML-in-Canvas WebGL2",
  "svg-backdrop": "Tier 1 · Chromium SVG Backdrop",
  "svg-content": "Tier 2 · Aave Content-Path",
  frost: "Tier 3 · High-Contrast Frost",
};

export function MaterialLab() {
  const [activeTab, setActiveTab] = useState("home");
  const [switchChecked, setSwitchChecked] = useState(true);
  const [sliderValue, setSliderValue] = useState(0.62);
  const [parkedLoupe, setParkedLoupe] = useState(false);
  const [plasmaPaused, setPlasmaPaused] = useState(false);
  const [cleanView, setCleanView] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [resolvedTier, setResolvedTier] = useState<ResolvedGlassTier>("svg-backdrop");
  const [diag, setDiag] = useState<GlassTabBarDiagnostics | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [layoutVersion, setLayoutVersion] = useState(0);

  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const ctrl = useDialKitController(
    "Liquid Glass Lab",
    {
      Material: {
        variant: {
          type: "select" as const,
          options: [
            { value: "regular", label: "Regular" },
            { value: "clear", label: "Clear" },
            { value: "tinted", label: "Tinted" },
          ],
          default: "regular",
        },
        profile: {
          type: "select" as const,
          options: [
            { value: "circle", label: "Circle (fold-free)" },
            { value: "c2squircle", label: "C² Squircle" },
            { value: "squircle", label: "Squircle" },
          ],
          default: "circle",
        },
        adaptiveContrast: true,
        tintColor: { type: "color" as const, default: "#0e121c" },
        frost: [1.4, 0, 12, 0.1] as [number, number, number, number],
        bodyOpacity: [0.18, 0, 0.75, 0.01] as [number, number, number, number],
      },
      Optics: {
        refraction: [1.0, 0, 1.3, 0.02] as [number, number, number, number],
        ior: [1.5168, 1.33, 1.75, 0.005] as [number, number, number, number],
        bezel: [16, 8, 24, 1] as [number, number, number, number],
        thickness: [22, 10, 34, 1] as [number, number, number, number],
        loupeDispersion: [0.62, 0, 1.0, 0.02] as [number, number, number, number],
      },
      "Light & Shadow": {
        _collapsed: true,
        lightAngle: [-125, -180, 180, 1] as [number, number, number, number],
        specular: [0.82, 0, 1, 0.02] as [number, number, number, number],
        backBounce: [0.55, 0, 1, 0.02] as [number, number, number, number],
        shadowStrength: [0.13, 0, 0.25, 0.01] as [number, number, number, number],
      },
      "Motion & Morph": {
        mergeRadius: [22, 0, 36, 1] as [number, number, number, number],
        fuseOrb: false,
        interactiveGlow: true,
        pressCompression: true,
      },
      Engine: {
        engine: {
          type: "select" as const,
          options: [
            { value: "auto", label: "Auto (Tier 0 -> 3)" },
            { value: "html-in-canvas", label: "Tier 0: HTML-in-Canvas" },
            { value: "svg-backdrop", label: "Tier 1: SVG Backdrop" },
            { value: "svg-content", label: "Tier 2: Aave Content" },
            { value: "frost", label: "Tier 3: Frost" },
          ],
          default: "auto",
        },
        backdrop: {
          type: "select" as const,
          options: [...BACKDROP_OPTIONS],
          default: "plasma",
        },
      },
      copyJsx: {
        type: "action" as const,
        label: "Copy JSX & Props",
      },
    },
    {
      id: "liquid-glass-material-lab",
      onAction: (action) => {
        if (action === "copyJsx") {
          setExportOpen(true);
        }
      },
    },
  );

  const d = ctrl.values;
  const variant = d.Material.variant as GlassVariant;
  const profile = d.Material.profile as GlassShapeProfile;
  const enginePref = d.Engine.engine as GlassEnginePreference;
  const backdrop = d.Engine.backdrop as LabBackdropId;
  const fuseOrb = d["Motion & Morph"].fuseOrb;

  // Apply URL query overrides once on mount (for shareable links & automated optical harness)
  const initializedQueryRef = useRef(false);
  useEffect(() => {
    if (initializedQueryRef.current) return;
    initializedQueryRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const qEngine = params.get("engine");
    const qBackdrop = params.get("backdrop");
    const qVariant = params.get("variant");
    const qProfile = params.get("profile");
    const qPaused = params.get("paused");
    const qParked = params.get("parked");
    const qFused = params.get("fused");

    if (
      qEngine === "auto" ||
      qEngine === "html-in-canvas" ||
      qEngine === "svg-backdrop" ||
      qEngine === "svg-content" ||
      qEngine === "frost"
    ) {
      ctrl.setValue("Engine.engine", qEngine);
    }
    if (
      qBackdrop === "plasma" ||
      qBackdrop === "ribbon" ||
      qBackdrop === "feed" ||
      qBackdrop === "grid" ||
      qBackdrop === "split"
    ) {
      ctrl.setValue("Engine.backdrop", qBackdrop);
    }
    if (qVariant === "regular" || qVariant === "clear" || qVariant === "tinted") {
      ctrl.setValue("Material.variant", qVariant);
    }
    if (qProfile === "circle" || qProfile === "c2squircle" || qProfile === "squircle") {
      ctrl.setValue("Material.profile", qProfile);
    }
    if (qPaused === "1" || qPaused === "true") setPlasmaPaused(true);
    if (qParked === "1" || qParked === "true") setParkedLoupe(true);
    if (qFused === "1" || qFused === "true") ctrl.setValue("Motion & Morph.fuseOrb", true);
  }, [ctrl]);

  // Sync coupled semantic defaults whenever Material.variant changes in DialKit
  const prevVariantRef = useRef<GlassVariant>(variant);
  useEffect(() => {
    if (prevVariantRef.current === variant) return;
    prevVariantRef.current = variant;
    const seed = GLASS_VARIANTS[variant];
    ctrl.setValues({
      Material: {
        tintColor: rgbToHex(seed.tintColor),
        frost: seed.blur,
        bodyOpacity: seed.tintAlpha,
      },
      Optics: {
        loupeDispersion: seed.loupeDispersion,
      },
      "Light & Shadow": {
        lightAngle: seed.lightAngleDeg,
        specular: seed.highlightColor.a,
        backBounce: seed.backBounce,
        shadowStrength: seed.shadowAlpha,
      },
    });
  }, [variant, ctrl]);

  // Keyboard shortcuts: H hides HUD/DialKit, P parks loupe, M toggles smin orb fusion
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "h") setCleanView((v) => !v);
      if (k === "p") setParkedLoupe((v) => !v);
      if (k === "m") {
        const cur = Boolean(ctrl.getValues()["Motion & Morph"].fuseOrb);
        ctrl.setValue("Motion & Morph.fuseOrb", !cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctrl]);

  const tabs = useMemo<readonly GlassTabItem[]>(
    () => [
      { id: "home", label: "Home", icon: (a) => <HomeIcon size={20} filled={a} /> },
      { id: "search", label: "Search", icon: () => <SearchIcon size={20} /> },
      { id: "saved", label: "Saved", icon: (a) => <HeartIcon size={20} filled={a} /> },
      { id: "library", label: "Library", icon: (a) => <LayersIcon size={20} filled={a} /> },
    ],
    [],
  );

  const opticsOverride = useMemo(
    () => ({
      ior: d.Optics.ior,
      bezel: d.Optics.bezel,
      thickness: d.Optics.thickness,
      tintColor: d.Material.tintColor,
      bodyOpacity: d.Material.bodyOpacity,
      lightAngle: d["Light & Shadow"].lightAngle,
      specular: d["Light & Shadow"].specular,
      backBounce: d["Light & Shadow"].backBounce,
      shadowStrength: d["Light & Shadow"].shadowStrength,
      pressCompression: d["Motion & Morph"].pressCompression,
      edgeRingLight: variant !== "tinted" && backdrop !== "feed" && backdrop !== "grid",
    }),
    [d, variant, backdrop],
  );

  const exportConfig: ExportableLabConfig = {
    variant,
    profile,
    adaptiveContrast: d.Material.adaptiveContrast,
    tintColor: d.Material.tintColor,
    frost: d.Material.frost,
    bodyOpacity: d.Material.bodyOpacity,
    refraction: d.Optics.refraction,
    ior: d.Optics.ior,
    bezel: d.Optics.bezel,
    thickness: d.Optics.thickness,
    loupeDispersion: d.Optics.loupeDispersion,
    lightAngle: d["Light & Shadow"].lightAngle,
    specular: d["Light & Shadow"].specular,
    backBounce: d["Light & Shadow"].backBounce,
    shadowStrength: d["Light & Shadow"].shadowStrength,
    mergeRadius: d["Motion & Morph"].mergeRadius,
    fuseOrb,
    interactiveGlow: d["Motion & Morph"].interactiveGlow,
    pressCompression: d["Motion & Morph"].pressCompression,
    engine: enginePref,
  };

  const centeredKit = backdrop === "plasma" || backdrop === "ribbon";

  const onDragStart = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: dragPos.x,
      originY: dragPos.y,
    };
  };

  const onDragMove = (e: PointerEvent<HTMLButtonElement>) => {
    const dr = dragRef.current;
    if (!dr.active || dr.pointerId !== e.pointerId) return;
    setDragPos({
      x: dr.originX + (e.clientX - dr.startX),
      y: dr.originY + (e.clientY - dr.startY),
    });
    setLayoutVersion((v) => v + 1);
  };

  const onDragEnd = (e: PointerEvent<HTMLButtonElement>) => {
    const dr = dragRef.current;
    if (!dr.active || dr.pointerId !== e.pointerId) return;
    dr.active = false;
  };

  const activeTabLabel = tabs.find((t) => t.id === activeTab)?.label ?? "Home";

  return (
    <div
      data-lab-engine={resolvedTier}
      data-lab-backdrop={backdrop}
      data-lab-contrast={diag?.legibility ? diag.legibility.worstContrast.toFixed(2) : ""}
    >
      <GlassStage
        engine={enginePref}
        variant={variant}
        shapeProfile={profile}
        refraction={d.Optics.refraction}
        dispersion={d.Optics.loupeDispersion}
        frost={d.Material.frost}
        interactive={d["Motion & Morph"].interactiveGlow}
        adaptiveContrast={d.Material.adaptiveContrast}
        optics={opticsOverride}
        continuousScene={backdrop === "plasma" && !plasmaPaused}
        sceneKey={`${backdrop}-${plasmaPaused ? "p" : "r"}`}
        layoutVersion={layoutVersion}
        sceneClassName={`lab-scene-bg--${backdrop}`}
        onTierChange={setResolvedTier}
      >
        {backdrop === "plasma" && <LiquidPlasmaBackdrop paused={plasmaPaused} />}
        {backdrop === "ribbon" && <TwistedRibbonBackdrop />}
        {backdrop === "feed" && <DaylightFeedBackdrop activeLabel={activeTabLabel} />}
        {backdrop === "grid" && <OpticsGridBackdrop />}
        {backdrop === "split" && <SplitPolarityBackdrop />}

        <GlassStage.Chrome>
          <div
            className={`lab-chrome-dock${centeredKit ? " lab-chrome-dock--centered" : ""}`}
            style={
              centeredKit
                ? {
                    transform: `translate3d(calc(-50% + ${dragPos.x}px), ${dragPos.y}px, 0)`,
                  }
                : undefined
            }
          >
            {centeredKit && !cleanView && (
              <button
                type="button"
                className="lab-drag-handle"
                aria-label="Drag kit anywhere to inspect refraction"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                <span>Drag kit</span>
              </button>
            )}

            <GlassContainer id="nav" mergeRadius={d["Motion & Morph"].mergeRadius}>
              <GlassTabBar
                items={tabs}
                value={activeTab}
                onChange={(next) => {
                  setParkedLoupe(false);
                  setActiveTab(next);
                }}
                parkedLoupe={parkedLoupe}
                onDiagnostics={setDiag}
              />
              <GlassOrb
                merged={fuseOrb}
                onClick={() => ctrl.setValue("Motion & Morph.fuseOrb", !fuseOrb)}
                aria-label={fuseOrb ? "Detach search orb" : "Fuse search orb with tab bar"}
                title="Click or press M to toggle smin liquid fusion"
              >
                <SearchIcon size={20} />
              </GlassOrb>
            </GlassContainer>

            <div className="lab-chrome-controls">
              <GlassSwitch
                checked={switchChecked}
                onCheckedChange={setSwitchChecked}
                aria-label="Liquid Glass Toggle Switch"
              />
              <GlassSlider
                value={sliderValue}
                onValueChange={setSliderValue}
                aria-label="Liquid Glass Range Slider"
              />
            </div>
          </div>
        </GlassStage.Chrome>
      </GlassStage>

      {/* Compact Top-Left HUD & Quick Actions */}
      {!cleanView ? (
        <>
          <header className="lab-hud">
            <Link href="/" className="lab-chip lab-chip--standalone">
              ← Showcase
            </Link>

            <div className="lab-pill-row" role="group" aria-label="Test backdrops">
              {BACKDROP_OPTIONS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  className={`lab-chip${backdrop === b.value ? " is-active" : ""}`}
                  onClick={() => {
                    ctrl.setValue("Engine.backdrop", b.value);
                    setDragPos({ x: 0, y: 0 });
                    setLayoutVersion((v) => v + 1);
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`lab-chip lab-chip--standalone${parkedLoupe ? " is-active" : ""}`}
              onClick={() => setParkedLoupe((v) => !v)}
              title="Freeze lifted refracting loupe between Home and Search (shortcut: P)"
            >
              <SparkleIcon size={14} />
              <span>{parkedLoupe ? "Loupe Parked" : "Park Loupe"}</span>
            </button>

            <button
              type="button"
              className={`lab-chip lab-chip--standalone${fuseOrb ? " is-active" : ""}`}
              onClick={() => ctrl.setValue("Motion & Morph.fuseOrb", !fuseOrb)}
              title="Toggle GlassContainer smin liquid meniscus fusion (shortcut: M)"
            >
              <span>{fuseOrb ? "Orb Fused" : "Fuse Orb"}</span>
            </button>

            {backdrop === "plasma" && (
              <button
                type="button"
                className={`lab-chip lab-chip--standalone${plasmaPaused ? " is-active" : ""}`}
                onClick={() => setPlasmaPaused((v) => !v)}
                title="Pause or resume animated plasma canvas"
              >
                <span>{plasmaPaused ? "Resume Plasma" : "Pause Plasma"}</span>
              </button>
            )}

            <button
              type="button"
              className="lab-chip lab-chip--standalone"
              onClick={() => setExportOpen(true)}
            >
              <CodeIcon size={14} />
              <span>Copy JSX &amp; Props</span>
            </button>

            <button
              type="button"
              className="lab-chip lab-chip--standalone"
              onClick={() => setCleanView(true)}
              title="Hide HUD and DialKit controls (shortcut: H)"
            >
              <span>Hide HUD</span>
            </button>
          </header>

          {/* Engine Diagnostics Pill & Mandatory DialKit Attribution */}
          <aside className="lab-diag-pill" aria-label="Optical diagnostics">
            <div className="lab-diag-pill__metrics">
              <strong className="lab-diag-pill__badge">{TIER_SHORT[resolvedTier]}</strong>
              {diag?.legibility && (
                <span className="lab-diag-pill__ok">
                  WCAG {diag.legibility.worstContrast.toFixed(1)}:1 AA
                </span>
              )}
              {diag?.bar && (
                <span className="lab-diag-pill__muted">
                  dMax {diag.bar.dMax.toFixed(2)}px · minJ{" "}
                  {diag.bar.clampedMinJacobian.toFixed(2)} · bake {diag.bar.bakeMs.toFixed(1)}ms
                </span>
              )}
            </div>
            <div className="lab-diag-pill__credit">
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
          </aside>

          <DialRoot position="top-right" defaultOpen theme="dark" productionEnabled />
        </>
      ) : (
        <button
          type="button"
          className="lab-unhide-btn"
          onClick={() => setCleanView(false)}
          title="Restore HUD and DialKit controls (shortcut: H)"
        >
          Show HUD (H)
        </button>
      )}

      <CopyCodeDrawer
        open={exportOpen}
        config={exportConfig}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
