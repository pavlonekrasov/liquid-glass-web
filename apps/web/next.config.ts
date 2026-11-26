import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// The landing page is not in the public repo, so without it "/" opens the Lab.
const hasLandingPage = existsSync(join(process.cwd(), "src/app/page.tsx"));

const nextConfig: NextConfig = {
  transpilePackages: ["@pavlonekrasov/liquid-glass-web"],
  ...(hasLandingPage
    ? {}
    : {
        async redirects() {
          return [{ source: "/", destination: "/lab", permanent: false }];
        },
      }),
};

export default nextConfig;
