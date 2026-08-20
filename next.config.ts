import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `c2pa-node` (Phase 27 / 9-C) is a NATIVE module: ContentAuth's Rust
  // c2pa-rs engine behind a napi binding. A `.node` binary cannot be placed
  // in an ESM chunk, so bundling it fails the moment an App Route reaches the
  // orchestrator. Marking it external leaves it to be required at runtime
  // from node_modules, which is the supported handling for native server
  // dependencies — and it stays server-only regardless: every module that
  // imports it carries `server-only`.
  serverExternalPackages: ["c2pa-node"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "higgsfield.ai",
      },
    ],
  },
};

export default nextConfig;
