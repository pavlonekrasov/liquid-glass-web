import type { Metadata } from "next";
import { CHROMIUM_REFRACT_INIT_SCRIPT } from "liquid-glass-web";
import "liquid-glass-web/styles.css";
import "dialkit/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "liquid-glass-web — Physically Grounded Apple Liquid Glass for the Web",
  description:
    "Open-source Apple iOS 26/27 Liquid Glass material and interactive component system with real h(0)=0 Snell refraction, 11-band Cauchy dispersion, dual-bounce Schlick Fresnel, smin liquid fusion, and 4-tier progressive enhancement.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
