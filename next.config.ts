import type { NextConfig } from "next";

// The studio keeps stubs in the browser (localStorage + share-link tokens), so routes render on
// request; Cache Components prerendering adds nothing here yet.
const nextConfig: NextConfig = {
  // One canonical origin: localStorage is per-origin, so stubs made on www would not show on the
  // apex (and vice versa).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.getticketstub.com" }],
        destination: "https://getticketstub.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
