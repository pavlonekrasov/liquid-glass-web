import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "motion", "motion/react"],
    banner: {
      js: '"use client";',
    },
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    entry: {
      "core/index": "src/core/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    onSuccess: async () => {
      mkdirSync(path.resolve("dist"), { recursive: true });
      copyFileSync(
        path.resolve("src/styles/styles.css"),
        path.resolve("dist/styles.css"),
      );
    },
  },
]);
