// --------------------------------------------------
// APP NAME, VERSION AND COPYRIGHT
//
// One place for the product name and owner. The version
// is package.json's, and the commit the build came from;
// next.config.ts puts both into the build, so the
// browser and the server show the same thing. Bump the
// version with `npm version patch|minor|major` and note
// the change in CHANGELOG.md.
// --------------------------------------------------

export const APP_NAME = "NAAR Studio";
export const COMPANY = "NAAR";

// The year the app was first released
const FIRST_YEAR = 2026;

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

// Short commit hash of the build, when known
export const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT || "";

// "v1.0.0" or "v1.0.0 (a1b2c3d)"
export function versionLabel(withCommit = false): string {
  return `v${APP_VERSION}${withCommit && APP_COMMIT ? ` (${APP_COMMIT})` : ""}`;
}

// "© 2026 NAAR" (a range once later years start)
export function copyrightLine(now = new Date()): string {
  const year = now.getFullYear();
  return `© ${year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : FIRST_YEAR} ${COMPANY}. All rights reserved.`;
}
