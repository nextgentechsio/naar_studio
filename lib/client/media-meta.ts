"use client";

import { useEffect, useState } from "react";

// --------------------------------------------------
// SIZE, LENGTH AND FILE SIZE OF A MEDIA FILE (browser)
//
// Read from a detached element, so the tiles showing the
// file aren't disturbed, and cached per link. Browser
// recordings (e.g. videos resized on upload) often say
// their length is Infinity until asked for a point past
// the end, which is done here, not on a visible player.
// --------------------------------------------------

export type MediaKind = "image" | "video" | "audio";

export type MediaMeta = {
  width?: number;
  height?: number;
  seconds?: number;
};

const metas = new Map<string, Promise<MediaMeta | null>>();
const sizes = new Map<string, Promise<number | null>>();

function read(src: string, kind: MediaKind): Promise<MediaMeta | null> {
  return new Promise((resolve) => {
    if (kind === "image") {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = src;
      return;
    }

    const media = document.createElement(kind);
    const done = () => {
      const video = media instanceof HTMLVideoElement ? media : null;
      resolve({
        width: video?.videoWidth || undefined,
        height: video?.videoHeight || undefined,
        seconds: Number.isFinite(media.duration) ? media.duration : undefined,
      });
      media.removeAttribute("src");
      media.load();
    };

    media.preload = "metadata";
    media.muted = true;
    media.onerror = () => resolve(null);
    media.onloadedmetadata = () => {
      if (Number.isFinite(media.duration)) return done();
      media.ontimeupdate = () => {
        media.ontimeupdate = null;
        done();
      };
      media.currentTime = Number.MAX_SAFE_INTEGER;
    };
    media.src = src;
  });
}

export function readMediaMeta(src: string, kind: MediaKind): Promise<MediaMeta | null> {
  const key = `${kind}:${src}`;
  let meta = metas.get(key);
  if (!meta) {
    meta = read(src, kind);
    metas.set(key, meta);
  }
  return meta;
}

// Bytes of a file at a link (a HEAD request; Content-
// Length is readable across origins), or of a local one
export function readFileSize(url: string): Promise<number | null> {
  let size = sizes.get(url);
  if (!size) {
    size = fetch(url, { method: url.startsWith("blob:") ? "GET" : "HEAD" })
      .then(async (response) => {
        if (!response.ok) return null;
        if (url.startsWith("blob:")) return (await response.blob()).size;
        const length = Number(response.headers.get("content-length"));
        return length > 0 ? length : null;
      })
      .catch(() => null);
    sizes.set(url, size);
  }
  return size;
}

// The details of `src`; `sizeOf` (the uploaded link, when
// `src` is a local preview) gives the file size if asked
export function useMediaMeta(
  src: string | null,
  // "file": anything else; only its size is read
  kind: MediaKind | "file",
  sizeOf?: string | null
): { meta: MediaMeta | null; bytes: number | null } {
  const [state, setState] = useState<{ key: string; meta: MediaMeta | null; bytes: number | null }>({
    key: "",
    meta: null,
    bytes: null,
  });
  const key = `${kind}:${src}:${sizeOf ?? ""}`;

  useEffect(() => {
    if (!src) return;
    let cancelled = false;

    void Promise.all([
      kind === "file" ? Promise.resolve(null) : readMediaMeta(src, kind),
      sizeOf === undefined ? Promise.resolve(null) : readFileSize(sizeOf ?? src),
    ]).then(([meta, bytes]) => {
      if (!cancelled) setState({ key, meta, bytes });
    });

    return () => {
      cancelled = true;
    };
  }, [key, src, kind, sizeOf]);

  return state.key === key ? state : { meta: null, bytes: null };
}

// "0:09", "1:05", "1:02:03"
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// "0:09 · 482×850 · 3.4 MB" (whatever is known)
export function describeMedia(meta: MediaMeta | null, bytes?: number | null): string {
  return [
    meta?.seconds !== undefined ? formatClock(meta.seconds) : null,
    meta?.width && meta.height ? `${meta.width}×${meta.height}` : null,
    bytes ? formatBytes(bytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
