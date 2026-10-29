import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = isStaticExport ? (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "") : "";

const nextConfig: NextConfig = {
  ...(isStaticExport && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
  ...(basePath && { basePath }),
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // Route handlers are named route.api.ts: they power manual refresh in local server mode and
  // are left out of the static export, which has no server.
  pageExtensions: isStaticExport ? ["tsx", "ts"] : ["tsx", "ts", "api.ts"],
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isStaticExport ? "1" : "",
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_REPO: process.env.NEXT_PUBLIC_REPO || process.env.GITHUB_REPOSITORY || "",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
