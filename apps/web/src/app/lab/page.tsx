import type { Metadata } from "next";
import { MaterialLab } from "@/components/MaterialLab";

export const metadata: Metadata = {
  title: "Material Lab — liquid-glass-web",
  description:
    "Interactive optical playground for liquid-glass-web powered by DialKit by Josh Puckett. Tune Snell refraction, Cauchy dispersion, Fresnel lighting, smin liquid fusion, and export JSX.",
};

export default function LabPage() {
  return <MaterialLab />;
}
