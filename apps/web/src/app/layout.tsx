import type { Metadata } from "next";
import localFont from "next/font/local";
import { CHROMIUM_REFRACT_INIT_SCRIPT } from "@pavlonekrasov/liquid-glass-web";
import "@pavlonekrasov/liquid-glass-web/styles.css";
import "dialkit/styles.css";
import "./fonts/fallbacks.css";
import "./globals.css";

/* Self-hosted Lora (headings) and Geist (body and UI). */
const lora = localFont({
  src: [
    { path: "./fonts/Lora.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/Lora-Italic.woff2", weight: "400 700", style: "italic" },
  ],
  variable: "--font-lora",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Lora Ext", "Lora Fallback"],
});

const loraExt = localFont({
  src: [
    { path: "./fonts/Lora-Ext.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/Lora-Italic-Ext.woff2", weight: "400 700", style: "italic" },
  ],
  declarations: [
    { prop: "font-family", value: "Lora Ext" },
    {
      prop: "unicode-range",
      value:
        "U+100-130, U+132-151, U+154-292, U+2C7-2C9, U+2DD-300, U+302-303, U+307, U+309-327, U+393-3C0, U+462-48F, U+492-4AF, U+4B2-1EF9, U+2074, U+20AE-2113, U+2126-212E, U+2202-2211, U+2219-27E9",
    },
  ],
  variable: "--font-lora-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const geist = localFont({
  src: [
    { path: "./fonts/Geist.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Geist.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Geist Ext", "Geist Fallback"],
});

const geistExt = localFont({
  src: [
    { path: "./fonts/Geist-Ext.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Geist-Ext.woff2", weight: "500", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "Geist Ext" },
    {
      prop: "unicode-range",
      value:
        "U+100-130, U+132-151, U+154-2B9, U+2C7-2C8, U+2DD-303, U+309-323, U+400-1EF9, U+20AA, U+20B1-2116, U+A78B-A78C",
    },
  ],
  variable: "--font-geist-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const fontVariables = [lora, loraExt, geist, geistExt].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "liquid-glass-web: Liquid Glass for the web",
  description:
    "Apple's Liquid Glass for the web. React components that refract and light whatever is behind them, like real glass, in every major browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: CHROMIUM_REFRACT_INIT_SCRIPT,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
