import type { NextConfig } from "next";

const config: NextConfig = {
  // Instagram media lives on Meta's CDN; we render it with plain <img>, so no
  // remotePatterns are needed. Server-only packages that must not be bundled:
  serverExternalPackages: ["openai"],
};

export default config;
