const withPWA = (await import("next-pwa")).default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // All pages here are dynamic (auth/DB-driven). Disable the client router
  // cache so navigating back to a page always refetches — otherwise a saved
  // settings change isn't visible when returning within the default 30s window.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push("better-sqlite3");
    }
    return config;
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
})(nextConfig);