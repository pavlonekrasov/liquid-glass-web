"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { DialRoot, useDialKitController } from "dialkit";
import {
  GLASS_VARIANTS,
  GlassContainer,
  GlassOrb,
  GlassSlider,
  GlassStage,
  GlassSwitch,
  GlassTabBar,
  cssColorFormat,
  formatCssColor,
  parseCssColor,
  type CssColorFormat,
  type GlassEnginePreference,
  type GlassShapeProfile,
  type GlassTabBarDiagnostics,
  type GlassTabItem,
  type GlassVariant,
  type ResolvedGlassTier,
} from "@pavlonekrasov/liquid-glass-web";
import { CopyCodeDrawer, type ExportableLabConfig } from "./CopyCodeDrawer";
import {
  ArrowLeftIcon,
  GripIcon,
  HeartIcon,
  HomeIcon,
  LayersIcon,
  SearchIcon,
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
  { value: "plasma", label: "Plasma" },
  { value: "ribbon", label: "Ribbon" },
  { value: "feed", label: "Feed" },
  { value: "grid", label: "Grid" },
  { value: "split", label: "Split" },
];

const TINT_FORMATS: readonly { value: CssColorFormat; label: string }[] = [
  { value: "hex", label: "Hex" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
  { value: "hwb", label: "HWB" },
  { value: "lab", label: "Lab" },
  { value: "lch", label: "LCH" },
  { value: "oklab", label: "OKLab" },
  { value: "oklch", label: "OKLCH" },
  { value: "display-p3", label: "Display P3" },
];

/** The formats DialKit's color picker writes itself. */
const isPickerFormat = (f: CssColorFormat | null): f is "hex" | "oklch" | "display-p3" =>
  f === "hex" || f === "oklch" || f === "display-p3";

const TIER_LABEL: Record<ResolvedGlassTier, string> = {
  "html-in-canvas": "HTML in canvas",
  "svg-backdrop": "SVG backdrop",
  "svg-content": "Content path",
  frost: "Frost",
};

const WIDE_QUERY = "(min-width: 821px)";

function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function MaterialLab() {
  // DialKit opens by default only where there is room for both panels.
  const isWide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
  const [activeTab, setActiveTab] = useState("home");
  const [switchChecked, setSwitchChecked] = useState(true);
  const [sliderValue, setSliderValue] = useState(0.62);
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

  // DialKit turns each key into its label, so keys are written in sentence case.
  const ctrl = useDialKitController(
    "Liquid Glass Lab",
    {
      Scene: {
        backdrop: {
          type: "select" as const,
          options: [...BACKDROP_OPTIONS],
          default: "plasma",
        },
        "park loupe": false,
        "fuse orb": false,
        "pause plasma": false,
      },
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
            { value: "circle", label: "Circle" },
            { value: "c2squircle", label: "C² squircle" },
            { value: "squircle", label: "Squircle" },
          ],
          default: "circle",
        },
        "adaptive contrast": true,
        tint: { type: "color" as const, default: "#0e121c" },
        "tint format": {
          type: "select" as const,
          options: TINT_FORMATS.map(({ value, label }) => ({ value, label })),
          default: "hex",
        },
        frost: [1.4, 0, 12, 0.1] as [number, number, number, number],
        "body opacity": [0.18, 0, 0.75, 0.01] as [number, number, number, number],
      },
      Optics: {
        refraction: [1.0, 0, 1.3, 0.02] as [number, number, number, number],
        "refractive index": [1.5168, 1.33, 1.75, 0.005] as [number, number, number, number],
        bezel: [16, 8, 24, 1] as [number, number, number, number],
        thickness: [22, 10, 34, 1] as [number, number, number, number],
        dispersion: [0.62, 0, 1.0, 0.02] as [number, number, number, number],
      },
      "Light and shadow": {
        _collapsed: true,
        "light angle": [-125, -180, 180, 1] as [number, number, number, number],
        specular: [0.82, 0, 1, 0.02] as [number, number, number, number],
        "back bounce": [0.55, 0, 1, 0.02] as [number, number, number, number],
        shadow: [0.13, 0, 0.25, 0.01] as [number, number, number, number],
      },
      Motion: {
        "merge radius": [22, 0, 36, 1] as [number, number, number, number],
        "interactive glow": true,
        "press compression": true,
      },
      Engine: {
        engine: {
          type: "select" as const,
          options: [
            // Auto names the engine it picked, so no separate readout is needed.
            { value: "auto", label: `Auto (${TIER_LABEL[resolvedTier]})` },
            { value: "html-in-canvas", label: "HTML in canvas" },
            { value: "svg-backdrop", label: "SVG backdrop" },
            { value: "svg-content", label: "Content path" },
            { value: "frost", label: "Frost" },
          ],
          default: "auto",
        },
      },
      "export code": { type: "action" as const, label: "Export code" },
    },
    {
      id: "liquid-glass-material-lab",
      shortcuts: {
        "Scene.park loupe": { key: "p" },
        "Scene.fuse orb": { key: "m" },
      },
      onAction: (action) => {
        if (action === "export code") setExportOpen(true);
      },
    },
  );

  const d = ctrl.values;
  const variant = d.Material.variant as GlassVariant;
  const profile = d.Material.profile as GlassShapeProfile;
  const enginePref = d.Engine.engine as GlassEnginePreference;
  const backdrop = d.Scene.backdrop as LabBackdropId;
  const parkedLoupe = d.Scene["park loupe"];
  const fuseOrb = d.Scene["fuse orb"];
  const plasmaPaused = d.Scene["pause plasma"];

  // A new backdrop recenters the kit.
  const [prevBackdrop, setPrevBackdrop] = useState(backdrop);
  if (prevBackdrop !== backdrop) {
    setPrevBackdrop(backdrop);
    setDragPos({ x: 0, y: 0 });
    setLayoutVersion((v) => v + 1);
  }

  // URL overrides, read once on mount (shareable links and the verify scripts)
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
    const qTint = params.get("tint");
    const qTintFormat = params.get("tintFormat");

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
      ctrl.setValue("Scene.backdrop", qBackdrop);
    }
    if (qVariant === "regular" || qVariant === "clear" || qVariant === "tinted") {
      ctrl.setValue("Material.variant", qVariant);
    }
    if (qProfile === "circle" || qProfile === "c2squircle" || qProfile === "squircle") {
      ctrl.setValue("Material.profile", qProfile);
    }
    if (qPaused === "1" || qPaused === "true") ctrl.setValue("Scene.pause plasma", true);
    if (qParked === "1" || qParked === "true") ctrl.setValue("Scene.park loupe", true);
    if (qFused === "1" || qFused === "true") ctrl.setValue("Scene.fuse orb", true);
    const tint = qTint ? parseCssColor(qTint) : null;
    if (qTint && tint) {
      const written = cssColorFormat(qTint);
      ctrl.setValue("Material.tint", isPickerFormat(written) ? qTint : formatCssColor(tint, "hex"));
      if (written) ctrl.setValue("Material.tint format", written);
    }
    if (TINT_FORMATS.some((f) => f.value === qTintFormat)) {
      ctrl.setValue("Material.tint format", qTintFormat as CssColorFormat);
    }
  }, [ctrl]);

  // The picker writes hex, OKLCH or Display P3; the format select covers every
  // CSS syntax. Choosing one of the picker's formats in either place updates the other.
  const tint = d.Material.tint;
  const tintFormat = d.Material["tint format"] as CssColorFormat;
  const pickerFormat = cssColorFormat(tint);
  const prevPickerFormatRef = useRef(pickerFormat);
  useEffect(() => {
    if (prevPickerFormatRef.current === pickerFormat) return;
    prevPickerFormatRef.current = pickerFormat;
    if (pickerFormat && pickerFormat !== tintFormat) ctrl.setValue("Material.tint format", pickerFormat);
  }, [pickerFormat, tintFormat, ctrl]);
  const prevTintFormatRef = useRef(tintFormat);
  useEffect(() => {
    if (prevTintFormatRef.current === tintFormat) return;
    prevTintFormatRef.current = tintFormat;
    const parsed = parseCssColor(tint);
    if (parsed && isPickerFormat(tintFormat) && pickerFormat !== tintFormat) {
      prevPickerFormatRef.current = tintFormat;
      ctrl.setValue("Material.tint", formatCssColor(parsed, tintFormat));
    }
  }, [tintFormat, tint, pickerFormat, ctrl]);
  const tintCss = useMemo(() => {
    if (pickerFormat === tintFormat) return tint;
    const parsed = parseCssColor(tint);
    return parsed ? formatCssColor(parsed, tintFormat) : tint;
  }, [tint, tintFormat, pickerFormat]);
  const pickerFormatRef = useRef(pickerFormat);
  pickerFormatRef.current = pickerFormat;

  // Changing the variant resets the settings tied to it
  const prevVariantRef = useRef<GlassVariant>(variant);
  useEffect(() => {
    if (prevVariantRef.current === variant) return;
    prevVariantRef.current = variant;
    const seed = GLASS_VARIANTS[variant];
    const keep = pickerFormatRef.current;
    ctrl.setValues({
      Material: {
        tint: formatCssColor(seed.tintColor, isPickerFormat(keep) ? keep : "hex"),
        frost: seed.blur,
        "body opacity": seed.tintAlpha,
      },
      Optics: {
        dispersion: seed.loupeDispersion,
      },
      "Light and shadow": {
        "light angle": seed.lightAngleDeg,
        specular: seed.highlightColor.a,
        "back bounce": seed.backBounce,
        shadow: seed.shadowAlpha,
      },
    });
  }, [variant, ctrl]);

  // H hides every control. P and M are DialKit shortcuts on the Scene toggles.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "h") setCleanView((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      ior: d.Optics["refractive index"],
      bezel: d.Optics.bezel,
      thickness: d.Optics.thickness,
      tintColor: tintCss,
      bodyOpacity: d.Material["body opacity"],
      lightAngle: d["Light and shadow"]["light angle"],
      specular: d["Light and shadow"].specular,
      backBounce: d["Light and shadow"]["back bounce"],
      shadowStrength: d["Light and shadow"].shadow,
      pressCompression: d.Motion["press compression"],
      edgeRingLight: variant !== "tinted" && backdrop !== "feed" && backdrop !== "grid",
    }),
    [d, tintCss, variant, backdrop],
  );

  const exportConfig: ExportableLabConfig = {
    variant,
    profile,
    adaptiveContrast: d.Material["adaptive contrast"],
    tintColor: tintCss,
    frost: d.Material.frost,
    bodyOpacity: d.Material["body opacity"],
    refraction: d.Optics.refraction,
    ior: d.Optics["refractive index"],
    bezel: d.Optics.bezel,
    thickness: d.Optics.thickness,
    loupeDispersion: d.Optics.dispersion,
    lightAngle: d["Light and shadow"]["light angle"],
    specular: d["Light and shadow"].specular,
    backBounce: d["Light and shadow"]["back bounce"],
    shadowStrength: d["Light and shadow"].shadow,
    mergeRadius: d.Motion["merge radius"],
    fuseOrb,
    interactiveGlow: d.Motion["interactive glow"],
    pressCompression: d.Motion["press compression"],
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

  const onDragKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[e.key];
    if (!move) return;
    e.preventDefault();
    setDragPos((p) => ({ x: p.x + move[0], y: p.y + move[1] }));
    setLayoutVersion((v) => v + 1);
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
        dispersion={d.Optics.dispersion}
        frost={d.Material.frost}
        interactive={d.Motion["interactive glow"]}
        adaptiveContrast={d.Material["adaptive contrast"]}
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
                aria-label="Move the glass. Drag, or use the arrow keys."
                title="Drag to move the glass"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onKeyDown={onDragKey}
              >
                <GripIcon size={14} />
              </button>
            )}

            <GlassContainer id="nav" mergeRadius={d.Motion["merge radius"]}>
              <GlassTabBar
                items={tabs}
                value={activeTab}
                onChange={(next) => {
                  if (parkedLoupe) ctrl.setValue("Scene.park loupe", false);
                  setActiveTab(next);
                }}
                parkedLoupe={parkedLoupe}
                onDiagnostics={setDiag}
              />
              <GlassOrb
                merged={fuseOrb}
                onClick={() => ctrl.setValue("Scene.fuse orb", !fuseOrb)}
                aria-label={fuseOrb ? "Detach search orb" : "Fuse search orb with tab bar"}
                title="Fuse with the tab bar (M)"
              >
                <SearchIcon size={20} />
              </GlassOrb>
            </GlassContainer>

            <div className="lab-chrome-controls">
              <GlassSwitch
                checked={switchChecked}
                onCheckedChange={setSwitchChecked}
                aria-label="Demo switch"
              />
              <GlassSlider
                value={sliderValue}
                onValueChange={setSliderValue}
                aria-label="Demo slider"
              />
            </div>
          </div>
        </GlassStage.Chrome>
      </GlassStage>

      <nav className="lab-bar" aria-label="Lab">
        {cleanView ? (
          <button
            type="button"
            className="lab-bar__btn"
            onClick={() => setCleanView(false)}
            aria-keyshortcuts="H"
          >
            Show controls <span className="lab-bar__key">H</span>
          </button>
        ) : (
          <>
            <Link href="/" className="lab-bar__btn">
              <ArrowLeftIcon size={14} />
              Liquid Glass
            </Link>
            <button
              type="button"
              className="lab-bar__btn"
              onClick={() => setCleanView(true)}
              aria-keyshortcuts="H"
            >
              Hide controls <span className="lab-bar__key">H</span>
            </button>
          </>
        )}
      </nav>

      {!cleanView && (
        <p className="lab-credit">
          Controls by{" "}
          <a href="https://dialkit.dev" target="_blank" rel="noreferrer">
            DialKit
          </a>{" "}
          from{" "}
          <a href="https://github.com/joshpuckett/dialkit" target="_blank" rel="noreferrer">
            Josh Puckett
          </a>
        </p>
      )}

      {!cleanView && (
        <DialRoot
          key={isWide ? "wide" : "narrow"}
          position="top-right"
          defaultOpen={isWide}
          theme="dark"
          productionEnabled
        />
      )}

      <CopyCodeDrawer
        open={exportOpen}
        config={exportConfig}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
