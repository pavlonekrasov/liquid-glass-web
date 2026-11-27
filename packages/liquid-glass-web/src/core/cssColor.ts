/* Parses any CSS color into sRGB bytes the engine can paint with. Colors outside
   sRGB (Display P3, Rec. 2020, wide OKLCH) are gamut mapped the way CSS Color 4
   specifies, by lowering OKLCH chroma, so hue and lightness are kept. */

export interface ParsedCssColor {
  /** sRGB channels, 0..255. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0..1 */
  readonly alpha: number;
}

export type CssColorFormat =
  | "hex"
  | "rgb"
  | "hsl"
  | "hwb"
  | "lab"
  | "lch"
  | "oklab"
  | "oklch"
  | "display-p3";

type Vec3 = [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

const mul = (m: Mat3, [x, y, z]: Vec3): Vec3 => [
  m[0][0] * x + m[0][1] * y + m[0][2] * z,
  m[1][0] * x + m[1][1] * y + m[1][2] * z,
  m[2][0] * x + m[2][1] * y + m[2][2] * z,
];

const LIN_SRGB_TO_XYZ: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LIN_P3_TO_XYZ: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const XYZ_TO_LIN_P3: Mat3 = [
  [2.493496911941425, -0.9313836179191239, -0.40271078445071684],
  [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577],
  [0.03584583024378447, -0.07617238926804182, 0.9568845240076872],
];
const LIN_A98_TO_XYZ: Mat3 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const LIN_PROPHOTO_TO_XYZ_D50: Mat3 = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LIN_REC2020_TO_XYZ: Mat3 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D65_TO_D50: Mat3 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const signed = (c: number, f: (v: number) => number) => Math.sign(c) * f(Math.abs(c));

const srgbDecode = (c: number) =>
  signed(c, (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
const srgbEncode = (c: number) =>
  signed(c, (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
const a98Decode = (c: number) => signed(c, (v) => Math.pow(v, 563 / 256));
const prophotoDecode = (c: number) => signed(c, (v) => (v <= 16 / 512 ? v / 16 : Math.pow(v, 1.8)));
const REC_A = 1.09929682680944;
const REC_B = 0.018053968510807;
const rec2020Decode = (c: number) =>
  signed(c, (v) => (v < REC_B * 4.5 ? v / 4.5 : Math.pow((v + REC_A - 1) / REC_A, 1 / 0.45)));

function oklabToLinSrgb([l, a, b]: Vec3): Vec3 {
  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function linSrgbToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToXyzD50([l, a, b]: Vec3): Vec3 {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > epsilon ? f0 ** 3 : (116 * f0 - 16) / kappa;
  const y = l > kappa * epsilon ? ((l + 16) / 116) ** 3 : l / kappa;
  const z = f2 ** 3 > epsilon ? f2 ** 3 : (116 * f2 - 16) / kappa;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

function xyzD50ToLab(xyz: Vec3): Vec3 {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const [x, y, z] = xyz.map((v, i) => v / D50_WHITE[i]) as Vec3;
  const f = (v: number) => (v > epsilon ? Math.cbrt(v) : (kappa * v + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const polar = (l: number, c: number, hDeg: number): Vec3 => {
  const h = (hDeg * Math.PI) / 180;
  return [l, c * Math.cos(h), c * Math.sin(h)];
};

const toPolar = ([l, a, b]: Vec3): Vec3 => {
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [l, Math.hypot(a, b), hue];
};

function hslToSrgb(h: number, s: number, l: number): Vec3 {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToSrgb(h: number, w: number, bl: number): Vec3 {
  if (w + bl >= 1) {
    const grey = w / (w + bl);
    return [grey, grey, grey];
  }
  return hslToSrgb(h, 1, 0.5).map((c) => c * (1 - w - bl) + w) as Vec3;
}

/* Gamut mapping (CSS Color 4, section 13.2): lower OKLCH chroma until the
   clipped color is within a just-noticeable difference of the unclipped one. */
const inUnit = (v: number) => v >= -1e-4 && v <= 1 + 1e-4;
const clip01 = (v: number) => Math.min(1, Math.max(0, v));
const deltaEOK = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function oklchToSrgb(l: number, c: number, h: number): Vec3 {
  return oklabToLinSrgb(polar(l, c, h)).map(srgbEncode) as Vec3;
}

function srgbToOklabEncoded(rgb: Vec3): Vec3 {
  return linSrgbToOklab(rgb.map(srgbDecode) as Vec3);
}

function gamutMapLinSrgb(lin: Vec3): Vec3 {
  const encoded = lin.map(srgbEncode) as Vec3;
  if (encoded.every(inUnit)) return encoded.map(clip01) as Vec3;

  const [l, c, h] = toPolar(linSrgbToOklab(lin));
  if (l >= 1) return [1, 1, 1];
  if (l <= 0) return [0, 0, 0];

  const JND = 0.02;
  let min = 0;
  let max = c;
  let current = oklchToSrgb(l, c, h);
  let clipped = current.map(clip01) as Vec3;
  if (deltaEOK(srgbToOklabEncoded(clipped), srgbToOklabEncoded(current)) < JND) return clipped;

  while (max - min > 1e-4) {
    const chroma = (min + max) / 2;
    current = oklchToSrgb(l, chroma, h);
    if (current.every(inUnit)) {
      min = chroma;
      continue;
    }
    clipped = current.map(clip01) as Vec3;
    const e = deltaEOK(srgbToOklabEncoded(clipped), srgbToOklabEncoded(current));
    if (e < JND) {
      if (JND - e < 1e-4) return clipped;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

const NAMED: Record<string, string> = Object.fromEntries(
  (
    "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc," +
    "bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a," +
    "burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50," +
    "cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b," +
    "darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b," +
    "darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000," +
    "darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f," +
    "darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff," +
    "dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0," +
    "forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520," +
    "gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4," +
    "indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5," +
    "lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff," +
    "lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1," +
    "lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899," +
    "lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32," +
    "linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd," +
    "mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee," +
    "mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970," +
    "mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6," +
    "olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa," +
    "palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9," +
    "peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399," +
    "red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460," +
    "seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd," +
    "slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c," +
    "teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff," +
    "whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32"
  )
    .split(",")
    .map((pair) => pair.split(":") as [string, string]),
);

/** A component: number, percentage (scaled by `percentOf`), or `none` (0). */
function num(token: string | undefined, percentOf: number): number | null {
  if (token === undefined) return null;
  if (token === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/.exec(token);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] ? (v / 100) * percentOf : v;
}

function angle(token: string | undefined): number | null {
  if (token === undefined) return null;
  if (token === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/.exec(token);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case "rad":
      return (v * 180) / Math.PI;
    case "grad":
      return v * 0.9;
    case "turn":
      return v * 360;
    default:
      return v;
  }
}

function splitArgs(body: string): { parts: string[]; alpha: string | undefined } | null {
  const trimmed = body.trim();
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((p) => p.trim());
    if (parts.some((p) => p === "" || /\s/.test(p))) return null;
    return { parts: parts.slice(0, 3), alpha: parts[3] };
  }
  const [left, right, extra] = trimmed.split("/");
  if (extra !== undefined) return null;
  const parts = left.trim().split(/\s+/);
  return { parts, alpha: right?.trim() };
}

function hexBytes(hex: string): [number, number, number, number] | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const n = hex.length;
  if (n === 3 || n === 4) {
    const v = [...hex].map((ch) => parseInt(ch + ch, 16));
    return [v[0], v[1], v[2], n === 4 ? v[3] / 255 : 1];
  }
  if (n === 6 || n === 8) {
    const v = hex.match(/../g)!.map((pair) => parseInt(pair, 16));
    return [v[0], v[1], v[2], n === 8 ? v[3] / 255 : 1];
  }
  return null;
}

/** Linear sRGB (unclamped) and alpha for one color, or null when it isn't recognised. */
function toLinearSrgb(input: string): { lin: Vec3; alpha: number } | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { lin: [0, 0, 0], alpha: 0 };
  if (s.startsWith("#")) {
    const v = hexBytes(s.slice(1));
    return v ? { lin: [v[0], v[1], v[2]].map((c) => srgbDecode(c / 255)) as Vec3, alpha: v[3] } : null;
  }
  const named = NAMED[s];
  if (named) return toLinearSrgb(`#${named}`);

  const fn = /^([a-z-]+)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const name = fn[1];
  const args = splitArgs(fn[2]);
  if (!args) return null;
  const { parts, alpha: alphaToken } = args;
  const alpha = alphaToken === undefined ? 1 : num(alphaToken, 1);
  if (alpha === null) return null;
  const a = Math.min(1, Math.max(0, alpha));

  if (name === "color") {
    const [space, ...rest] = parts;
    if (rest.length !== 3) return null;
    const v = rest.map((t) => num(t, 1));
    if (v.some((x) => x === null)) return null;
    const c = v as Vec3;
    let xyz: Vec3;
    switch (space) {
      case "srgb":
        return { lin: c.map(srgbDecode) as Vec3, alpha: a };
      case "srgb-linear":
        return { lin: c, alpha: a };
      case "display-p3":
        xyz = mul(LIN_P3_TO_XYZ, c.map(srgbDecode) as Vec3);
        break;
      case "a98-rgb":
        xyz = mul(LIN_A98_TO_XYZ, c.map(a98Decode) as Vec3);
        break;
      case "prophoto-rgb":
        xyz = mul(D50_TO_D65, mul(LIN_PROPHOTO_TO_XYZ_D50, c.map(prophotoDecode) as Vec3));
        break;
      case "rec2020":
        xyz = mul(LIN_REC2020_TO_XYZ, c.map(rec2020Decode) as Vec3);
        break;
      case "xyz":
      case "xyz-d65":
        xyz = c;
        break;
      case "xyz-d50":
        xyz = mul(D50_TO_D65, c);
        break;
      default:
        return null;
    }
    return { lin: mul(XYZ_TO_LIN_SRGB, xyz), alpha: a };
  }

  if (parts.length !== 3) return null;
  const [p0, p1, p2] = parts;
  switch (name) {
    case "rgb":
    case "rgba": {
      const v = [num(p0, 255), num(p1, 255), num(p2, 255)];
      if (v.some((x) => x === null)) return null;
      return { lin: (v as Vec3).map((c) => srgbDecode(c / 255)) as Vec3, alpha: a };
    }
    case "hsl":
    case "hsla":
    case "hwb": {
      const h = angle(p0);
      const x = num(p1.endsWith("%") ? p1 : `${p1}%`, 1);
      const y = num(p2.endsWith("%") ? p2 : `${p2}%`, 1);
      if (h === null || x === null || y === null) return null;
      const rgb = name === "hwb" ? hwbToSrgb(h, x, y) : hslToSrgb(h, x, y);
      return { lin: rgb.map(srgbDecode) as Vec3, alpha: a };
    }
    case "lab":
    case "lch": {
      const l = num(p0, 100);
      if (l === null) return null;
      let lab: Vec3;
      if (name === "lab") {
        const x = num(p1, 125);
        const y = num(p2, 125);
        if (x === null || y === null) return null;
        lab = [l, x, y];
      } else {
        const c = num(p1, 150);
        const h = angle(p2);
        if (c === null || h === null) return null;
        lab = polar(l, Math.max(0, c), h);
      }
      return { lin: mul(XYZ_TO_LIN_SRGB, mul(D50_TO_D65, labToXyzD50(lab))), alpha: a };
    }
    case "oklab":
    case "oklch": {
      const l = num(p0, 1);
      if (l === null) return null;
      let lab: Vec3;
      if (name === "oklab") {
        const x = num(p1, 0.4);
        const y = num(p2, 0.4);
        if (x === null || y === null) return null;
        lab = [l, x, y];
      } else {
        const c = num(p1, 0.4);
        const h = angle(p2);
        if (c === null || h === null) return null;
        lab = polar(l, Math.max(0, c), h);
      }
      return { lin: oklabToLinSrgb(lab), alpha: a };
    }
    default:
      return null;
  }
}

const cache = new Map<string, ParsedCssColor | null>();

/**
 * Parses a CSS color in any syntax (hex, named, rgb, hsl, hwb, lab, lch, oklab,
 * oklch, color() spaces) into sRGB bytes, gamut mapping wide-gamut colors.
 * Returns null for anything it can't read without a browser, such as var().
 */
export function parseCssColor(input: string): ParsedCssColor | null {
  const key = input.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const parsed = toLinearSrgb(key);
  let result: ParsedCssColor | null = null;
  if (parsed) {
    const [r, g, b] = gamutMapLinSrgb(parsed.lin);
    const byte = (v: number) => Math.round(v * 255 * 1e6) / 1e6;
    result = { r: byte(r), g: byte(g), b: byte(b), alpha: parsed.alpha };
  }
  if (cache.size > 256) cache.clear();
  cache.set(key, result);
  return result;
}

/**
 * Like parseCssColor, and in a browser also resolves what only the page can:
 * var(), color-mix(), relative colors and currentColor.
 */
export function resolveCssColor(input: string): ParsedCssColor | null {
  const parsed = parseCssColor(input);
  if (parsed || typeof document === "undefined" || !document.body) return parsed;
  const probe = document.createElement("span");
  probe.style.color = input;
  if (!probe.style.color) return null;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return parseCssColor(computed);
}

/** Which syntax a color string is written in, or null when it's none of the formats below. */
export function cssColorFormat(input: string): CssColorFormat | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) return "hex";
  if (s.startsWith("color(") && /\bdisplay-p3\b/.test(s)) return "display-p3";
  const m = /^([a-z]+)a?\(/.exec(s);
  if (!m) return null;
  const name = m[1] === "rgba" ? "rgb" : m[1] === "hsla" ? "hsl" : m[1];
  return (["rgb", "hsl", "hwb", "lab", "lch", "oklab", "oklch"] as const).find((f) => f === name) ?? null;
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Writes an sRGB color (channels 0..255) in the given CSS syntax. */
export function formatCssColor(
  color: { readonly r: number; readonly g: number; readonly b: number; readonly alpha?: number },
  format: CssColorFormat,
): string {
  const alpha = color.alpha ?? 1;
  const enc: Vec3 = [color.r / 255, color.g / 255, color.b / 255];
  const lin = enc.map(srgbDecode) as Vec3;
  const slash = alpha < 1 ? ` / ${round(alpha, 3)}` : "";
  const hue = (h: number, c: number) => (c < 1e-4 ? 0 : round(h, 2));

  switch (format) {
    case "hex": {
      const byte = (v: number) => Math.round(clip01(v) * 255).toString(16).padStart(2, "0");
      return `#${enc.map(byte).join("")}${alpha < 1 ? byte(alpha) : ""}`;
    }
    case "rgb":
      return `rgb(${enc.map((v) => Math.round(clip01(v) * 255)).join(" ")}${slash})`;
    case "hsl":
    case "hwb": {
      const [r, g, b] = enc;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      let h = 0;
      if (d > 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
      }
      if (format === "hwb") return `hwb(${round(h, 1)} ${round(min * 100, 1)}% ${round((1 - max) * 100, 1)}%${slash})`;
      const l = (max + min) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      return `hsl(${round(h, 1)} ${round(s * 100, 1)}% ${round(l * 100, 1)}%${slash})`;
    }
    case "lab":
    case "lch": {
      const lab = xyzD50ToLab(mul(D65_TO_D50, mul(LIN_SRGB_TO_XYZ, lin)));
      if (format === "lab") return `lab(${round(lab[0], 2)} ${round(lab[1], 2)} ${round(lab[2], 2)}${slash})`;
      const [l, c, h] = toPolar(lab);
      return `lch(${round(l, 2)} ${round(c, 2)} ${hue(h, c)}${slash})`;
    }
    case "oklab":
    case "oklch": {
      const lab = linSrgbToOklab(lin);
      if (format === "oklab") return `oklab(${round(lab[0], 4)} ${round(lab[1], 4)} ${round(lab[2], 4)}${slash})`;
      const [l, c, h] = toPolar(lab);
      return `oklch(${round(l, 4)} ${round(c, 4)} ${hue(h, c)}${slash})`;
    }
    case "display-p3": {
      const p3 = mul(XYZ_TO_LIN_P3, mul(LIN_SRGB_TO_XYZ, lin)).map(srgbEncode);
      return `color(display-p3 ${p3.map((v) => round(clip01(v), 4)).join(" ")}${slash})`;
    }
  }
}
