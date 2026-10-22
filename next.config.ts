import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Generate page is now Replicate; keep old links
  // and bookmarks working
  redirects() {
    return [{ source: "/generate", destination: "/replicate", permanent: false }];
  },
};

export default nextConfig;
