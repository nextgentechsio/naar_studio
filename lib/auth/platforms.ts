// --------------------------------------------------
// PLATFORM ACCESS (per user)
//
// Which Create platforms each account may use. Pure, so
// the server (authoritative: lib/auth/platform-access.ts)
// and the client (menu, Users page) share it.
//
// - Stored on the user as `platforms`; missing means every
//   platform (existing accounts, and future platforms,
//   stay on until an admin narrows them).
// - The super admin always has every platform.
// - An admin can only grant platforms they have; ones they
//   lack are left as they were on the account.
// --------------------------------------------------

export const STUDIO_PLATFORMS = [
  { key: "replicate", label: "Replicate", href: "/replicate", hint: "Image and video models" },
  { key: "higgsfield", label: "Higgsfield", href: "/higgsfield", hint: "Video" },
  { key: "elevenlabs", label: "ElevenLabs", href: "/elevenlabs", hint: "Voice and audio" },
  { key: "catalogue", label: "Catalogue", href: "/catalogue", hint: "Fashion catalogue shoots" },
] as const;

export type PlatformKey = (typeof STUDIO_PLATFORMS)[number]["key"];

export const ALL_PLATFORMS: PlatformKey[] = STUDIO_PLATFORMS.map((platform) => platform.key);

export function platformLabel(key: PlatformKey): string {
  return STUDIO_PLATFORMS.find((platform) => platform.key === key)?.label ?? key;
}

export function isPlatformKey(value: unknown): value is PlatformKey {
  return typeof value === "string" && (ALL_PLATFORMS as string[]).includes(value);
}

// What an account may use, from its role and stored list
export function resolvePlatforms(role: string, stored: readonly string[] | null | undefined): PlatformKey[] {
  if (role === "super_admin" || !stored) return [...ALL_PLATFORMS];
  return ALL_PLATFORMS.filter((key) => stored.includes(key));
}

export function canUsePlatform(user: { platforms: readonly PlatformKey[] }, key: PlatformKey): boolean {
  return user.platforms.includes(key);
}

// A requested list from a form: null when it isn't a list
// of known platforms
export function parsePlatforms(value: unknown): PlatformKey[] | null {
  if (!Array.isArray(value) || !value.every(isPlatformKey)) return null;
  return ALL_PLATFORMS.filter((key) => value.includes(key));
}

// The account's new list when `actor` asks for `requested`:
// platforms the actor lacks keep the account's current
// state. Null when asking to grant one the actor lacks.
export function mergePlatforms(
  actorPlatforms: readonly PlatformKey[],
  current: readonly PlatformKey[],
  requested: readonly PlatformKey[],
): PlatformKey[] | null {
  if (requested.some((key) => !actorPlatforms.includes(key) && !current.includes(key))) return null;
  return ALL_PLATFORMS.filter((key) =>
    actorPlatforms.includes(key) ? requested.includes(key) : current.includes(key),
  );
}

// Where a signed-in user lands: their first platform, or
// History when they have none
export function homeFor(platforms: readonly PlatformKey[]): string {
  return STUDIO_PLATFORMS.find((platform) => platforms.includes(platform.key))?.href ?? "/history";
}
