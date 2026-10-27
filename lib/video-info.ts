import { fetchAllowed } from "@/lib/output-source";

// --------------------------------------------------
// VIDEO SIZE AND LENGTH (server side)
//
// Reads an MP4 / MOV's width, height and length from its
// "moov" box, with a few range requests instead of the
// whole download. Used to bill metered Higgsfield runs
// (lib/higgsfield.ts). Null when the file can't be read
// or isn't a video.
// --------------------------------------------------

export type VideoInfo = { width: number; height: number; seconds: number };

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
// A server that ignores ranges sends the whole file
const MAX_WHOLE_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;
const TIMEOUT_MS = 30_000;

type Box = { type: string; data: Buffer };

// The boxes directly inside `buffer`
function boxes(buffer: Buffer): Box[] {
  const found: Box[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    let header = 8;

    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }

    if (size < header || offset + size > buffer.length) break;

    found.push({ type, data: buffer.subarray(offset + header, offset + size) });
    offset += size;
  }

  return found;
}

function child(box: Box | undefined, type: string): Box | undefined {
  return box ? boxes(box.data).find((item) => item.type === type) : undefined;
}

// Width, height and length from a moov box's contents
function readMoov(moov: Buffer): VideoInfo | null {
  const top = boxes(moov);
  const mvhd = top.find((box) => box.type === "mvhd")?.data;
  if (!mvhd || mvhd.length < 20) return null;

  const v1 = mvhd[0] === 1;
  const timescale = mvhd.readUInt32BE(v1 ? 20 : 12);
  const movieDuration = v1 ? Number(mvhd.readBigUInt64BE(24)) : mvhd.readUInt32BE(16);
  if (!timescale) return null;

  // The largest track with a picture
  let best: VideoInfo | null = null;

  for (const trak of top.filter((box) => box.type === "trak")) {
    const tkhd = child(trak, "tkhd")?.data;
    if (!tkhd || tkhd.length < 84) continue;

    const width = tkhd.readUInt32BE(tkhd.length - 8) / 65536;
    const height = tkhd.readUInt32BE(tkhd.length - 4) / 65536;
    if (!width || !height) continue;

    const trackV1 = tkhd[0] === 1;
    const duration = trackV1 ? Number(tkhd.readBigUInt64BE(28)) : tkhd.readUInt32BE(20);

    if (!best || width * height > best.width * best.height) {
      best = {
        width: Math.round(width),
        height: Math.round(height),
        seconds: (duration || movieDuration) / timescale,
      };
    }
  }

  return best;
}

// Drop a body we won't read. Not awaited: on Next's
// server fetch, awaiting cancel() can hang forever.
function release(response: Response) {
  response.body?.cancel().catch(() => {});
}

async function readAll(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_WHOLE_FILE_BYTES || !response.body) {
    release(response);
    return null;
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_WHOLE_FILE_BYTES) return null;
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function videoInfo(
  url: URL,
  isAllowed: (url: URL) => boolean
): Promise<VideoInfo | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  // `bytes` from `start`; or the whole file when the
  // server ignores ranges
  const read = async (start: number, length: number) => {
    const response = await fetchAllowed(url, isAllowed, {
      headers: { Range: `bytes=${start}-${start + length - 1}` },
      signal,
    });

    if (response.status === 206) {
      return { range: Buffer.from(await response.arrayBuffer()) };
    }
    if (response.status === 200) {
      return { whole: await readAll(response) };
    }

    release(response);
    return null;
  };

  try {
    let offset = 0;

    for (let count = 0; count < MAX_TOP_LEVEL_BOXES; count++) {
      const head = await read(offset, 16);
      if (!head) return null;

      if ("whole" in head) {
        const moov = head.whole && boxes(head.whole).find((box) => box.type === "moov");
        return moov ? readMoov(moov.data) : null;
      }

      if (head.range.length < 8) return null;

      let size = head.range.readUInt32BE(0);
      const type = head.range.toString("latin1", 4, 8);
      let header = 8;

      if (size === 1) {
        if (head.range.length < 16) return null;
        size = Number(head.range.readBigUInt64BE(8));
        header = 16;
      }
      // Runs to the end of the file: nothing after it
      if (size === 0 && type !== "moov") return null;

      if (type === "moov") {
        if (size === 0 || size > MAX_MOOV_BYTES) return null;
        const moov = (await read(offset, size))?.range;
        if (!moov || moov.length < size) return null;
        return readMoov(moov.subarray(header));
      }

      if (size < header) return null;
      offset += size;
    }

    return null;
  } catch (error) {
    console.error("Video measure failed:", url.host, error instanceof Error ? error.message : error);
    return null;
  }
}
