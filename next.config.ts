import type { NextConfig } from "next";

// The studio keeps stubs in the browser (localStorage + share-link tokens), so routes render on
// request; Cache Components prerendering adds nothing here yet.
const nextConfig: NextConfig = {};

export default nextConfig;
