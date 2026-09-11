const withPWA = (await import("next-pwa")).default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // staleTimes.dynamic stays at its default (30s): the client router cache
  // makes back-navigation to /viewer restore instantly instead of remounting
  // and refetching everything. Settings freshness is unaffected —
  // settings-client handleSave calls router.refresh() after every save.
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