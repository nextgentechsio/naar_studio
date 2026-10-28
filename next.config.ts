import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// The app's version (package.json) and the commit it was
// built from, for lib/app-info.ts. Vercel says the commit;
// elsewhere git does, if it's there.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

function buildCommit(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_COMMIT: buildCommit(),
  },

  // The Generate page is now Replicate; keep old links
  // and bookmarks working
  redirects() {
    return [{ source: "/generate", destination: "/replicate", permanent: false }];
  },
};

export default nextConfig;
