import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// --------------------------------------------------
// FETCHING A PICTURE FROM ANOTHER WEBSITE (pasted or
// dropped onto a board)
//
// The address comes from the user, so the server only
// goes to the public internet: http(s), no credentials in
// the URL, and every address the host name resolves to
// (and every redirect hop) must be public, so nobody can
// use a board to reach internal machines.
// --------------------------------------------------

export const MAX_REMOTE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 20_000;

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return privateV4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    // IPv4 inside IPv6 (::ffff:10.0.0.1)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateV4(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff")
    );
  }
  return true;
}

// Tests point at a local stand-in server; nothing else may
function allowedForTests(url: URL): boolean {
  const base = process.env.BOARDS_TEST_REMOTE_ORIGIN;
  return Boolean(base) && url.origin === base;
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new RemoteError("Only web addresses (http or https) can be added");
  if (url.username || url.password) throw new RemoteError("That address isn't allowed");
  if (allowedForTests(url)) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new RemoteError("That website couldn't be found");
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new RemoteError("That address isn't allowed");
}

export class RemoteError extends Error {}

// The file at a public address: image or video only,
// size-capped, redirects followed by hand (each checked)
export async function fetchRemoteMedia(raw: string): Promise<{ bytes: Buffer; contentType: string; name: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteError("That isn't a web address");
  }

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "image/*,video/*;q=0.9,*/*;q=0.5", "User-Agent": "Mozilla/5.0 (compatible; NaarStudioBoards/1.0)" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      response = null;
      continue;
    }
    break;
  }
  if (!response) throw new RemoteError("That website redirected too many times");
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new RemoteError(`That website refused the download (${response.status})`);
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^(image|video)\//.test(contentType) || contentType === "image/svg+xml") {
    await response.body.cancel();
    throw new RemoteError("That address isn't a picture or video");
  }
  if (Number(response.headers.get("content-length")) > MAX_REMOTE_BYTES) {
    await response.body.cancel();
    throw new RemoteError("That file is larger than 50 MB");
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_REMOTE_BYTES) {
      await reader.cancel();
      throw new RemoteError("That file is larger than 50 MB");
    }
    chunks.push(value);
  }

  const last = decodeURIComponent(url.pathname.split("/").pop() || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
  return { bytes: Buffer.concat(chunks), contentType, name: last || `pasted.${contentType.split("/")[1] ?? "bin"}` };
}
