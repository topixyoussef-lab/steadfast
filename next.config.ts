import { execSync } from "node:child_process";

import type { NextConfig } from "next";

/**
 * Identifies the build the client bundle came from. The server reports the same
 * stamp from /api/version, so a client still running an older bundle can tell
 * that a newer one has been deployed and ask to be reloaded.
 *
 * The commit SHA is preferred because it is stable across reboots and matches
 * `git log`; the timestamp only covers a checkout with no .git.
 */
function buildStamp(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return String(Date.now());
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_STAMP: buildStamp(),
  },

  async headers() {
    return [
      {
        // Vercel serves public/ with `Content-Disposition: inline`, which asks
        // the browser to render the body instead of saving it. On a phone — and
        // especially inside the installed app — that is the difference between
        // the APK reaching the download tray and nothing visibly happening.
        source: "/steadfast.apk",
        headers: [
          {
            key: "Content-Disposition",
            value: 'attachment; filename="steadfast.apk"',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
