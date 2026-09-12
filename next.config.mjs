const withPWA = (await import("next-pwa")).default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    staleTimes: {
      // Next 14's default for dynamic routes is 0 — every revisit refetches
      // the page payload (through the tunnel here), flashing loading.tsx and
      // remounting the viewer. A 30s window serves the cached shell instantly
      // on revisit; client data goes through viewer-cache.ts (SWR) anyway.
      // Settings freshness is unaffected: handleSave calls router.refresh().
      dynamic: 30,
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push("better-sqlite3", "sharp");
    }
    return config;
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      // Media files (immutable, ETagged) — cache what the user viewed so
      // revisits and offline browsing are instant. Bounded so a huge library
      // can't balloon storage; LRU evicts oldest.
      urlPattern: /\/api\/media\/file.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "diurn-media",
        expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
})(nextConfig);