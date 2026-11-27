import type { Metadata } from "next";
import { MaterialLab } from "@/components/MaterialLab";

export const metadata: Metadata = {
  title: "Material Lab — liquid-glass-web",
  description:
    "Tune every liquid-glass-web setting live with sliders, powered by DialKit by Josh Puckett, then copy the JSX.",
};

export default function LabPage() {
  return <MaterialLab />;
}
