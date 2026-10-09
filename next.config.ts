import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,

  // PGlite ships WebAssembly + a filesystem image that must be loaded from
  // node_modules at runtime rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@electric-sql/pglite/dist/*.wasm",
      "./node_modules/@electric-sql/pglite/dist/*.data",
      // Pre-migrated schema snapshot produced by `npm run db:snapshot`.
      "./.data/*.tar.gz",
    ],
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Authenticated pages and API responses carry account data and must
        // never be stored by shared caches.
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
