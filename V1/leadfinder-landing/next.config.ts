import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "export",
  turbopack: {
    // The dashboard source remains shared with the Express package during the
    // migration, so both folders must live inside Turbopack's resolution root.
    root: path.join(__dirname, ".."),
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
