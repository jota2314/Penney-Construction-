import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  turbopack: {
    root: ".",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "kozgjatzmllhvqwqbzzy.supabase.co",
        pathname: "/storage/v1/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // This host is the staff app, not the company website, so every
        // response (pages, API, files) stays out of search and AI indexes.
        // No robots.txt Disallow on purpose: a crawler that is blocked never
        // fetches the page, so it would never see this noindex.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
