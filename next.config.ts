import type { NextConfig } from "next";

const GO_ENGINE_URL = process.env.GO_ENGINE_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  async rewrites() {
    return [
      // Proxy SSE stream directly to Go engine (rewrites support streaming)
      {
        source: "/api/projects/:id/events",
        destination: `${GO_ENGINE_URL}/engine/projects/:id/events`,
      },
    ];
  },
};

export default nextConfig;
