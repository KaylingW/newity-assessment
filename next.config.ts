import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must stay a plain Node require, not bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
