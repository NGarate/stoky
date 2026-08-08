import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: "standalone",

  // Hosts allowed to load dev assets. Without this, `next dev` answers 403 to
  // requests for /_next/static chunks from any origin other than localhost, so
  // the page renders but never hydrates — and the login form silently falls
  // back to a native GET. Affects development only; it has no effect on a
  // production build. Add the LAN address you use to test from other devices.
  allowedDevOrigins: [
    "192.168.8.132",
    // Convenience for testing from a phone on the same network. Narrow this to
    // specific addresses if the network is not trusted.
    "192.168.8.*",
    // Tailscale. The entry that matters is this machine's own address, since
    // that is the Host the browser requests; the second is another node on the
    // tailnet, kept for when the server is reached through it.
    "100.87.171.28",
    "100.124.170.3",
  ],
};

export default withNextIntl(nextConfig);
