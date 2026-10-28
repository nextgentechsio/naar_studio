import { fetchAllowed } from "@/lib/storage/output-source";

// --------------------------------------------------
// VIDEO SIZE AND LENGTH (server side)
//
// Reads an MP4 / MOV's width, height and length from its
// "moov" box, with a few range requests instead of the
// whole download. Used to bill metered Higgsfield runs
// (lib/higgsfield/client.ts). Null when the file can't be read
// or isn't a video.
// --------------------------------------------------

export type VideoInfo = { width: number; height: number; seconds: number };

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
// A server that ignores ranges sends the whole file
const MAX_WHOLE_FILE_BYTES = 100 * 1024 * 1024;
// Fragmented files have a moof + mdat pair per second
// or so; enough for a few minutes of video
const MAX_TOP_LEVEL_BOXES = 512;
const MAX_MOOF_BYTES = 4 * 1024 * 1024;
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

// The video track's own clock, for reading fragments
type Track = { id: number; timescale: number; defaultDuration: number };

type Moov = { info: VideoInfo; track: Track | null; fragmented: boolean };

// Width, height and length from a moov box's contents.
// A fragmented file (moov holds an mvex; e.g. what a
// browser's MediaRecorder writes) keeps its real length
// in the fragments: `track` is what's needed to add them
// up (see fragmentEnd).
function readMoov(moov: Buffer): Moov | null {
  const top = boxes(moov);
  const mvhd = top.find((box) => box.type === "mvhd")?.data;
  if (!mvhd || mvhd.length < 20) return null;

  const v1 = mvhd[0] === 1;
  const timescale = mvhd.readUInt32BE(v1 ? 20 : 12);
  const movieDuration = v1 ? Number(mvhd.readBigUInt64BE(24)) : mvhd.readUInt32BE(16);
  if (!timescale) return null;

  const mvex = top.find((box) => box.type === "mvex");

  // The largest track with a picture
  let best: Moov | null = null;

  for (const trak of top.filter((box) => box.type === "trak")) {
    const tkhd = child(trak, "tkhd")?.data;
    if (!tkhd || tkhd.length < 84) continue;

    const width = tkhd.readUInt32BE(tkhd.length - 8) / 65536;
    const height = tkhd.readUInt32BE(tkhd.length - 4) / 65536;
    if (!width || !height) continue;

    const trackV1 = tkhd[0] === 1;
    const id = tkhd.readUInt32BE(trackV1 ? 20 : 12);
    const duration = trackV1 ? Number(tkhd.readBigUInt64BE(28)) : tkhd.readUInt32BE(20);

    const mdhd = child(child(trak, "mdia"), "mdhd")?.data;
    const mediaTimescale = mdhd && mdhd.length >= 24 ? mdhd.readUInt32BE(mdhd[0] === 1 ? 20 : 12) : 0;

    const trex = mvex
      ? boxes(mvex.data).find((box) => box.type === "trex" && box.data.length >= 16 && box.data.readUInt32BE(4) === id)
      : undefined;

    if (!best || width * height > best.info.width * best.info.height) {
      best = {
        info: {
          width: Math.round(width),
          height: Math.round(height),
          seconds: (duration || movieDuration) / timescale,
        },
        track: mediaTimescale
          ? { id, timescale: mediaTimescale, defaultDuration: trex ? trex.data.readUInt32BE(12) : 0 }
          : null,
        fragmented: Boolean(mvex),
      };
    }
  }

  return best;
}

// Where a fragment (moof) of `track` ends, in the
// track's timescale: its start (tfdt) plus each sample's
// duration (trun, else tfhd's or trex's default). `from`
// is where the previous one ended, for fragments with no
// start of their own.
function fragmentEnd(moof: Buffer, track: Track, from: number): number | null {
  let end: number | null = null;

  for (const traf of boxes(moof).filter((box) => box.type === "traf")) {
    const parts = boxes(traf.data);
    const tfhd = parts.find((box) => box.type === "tfhd")?.data;
    if (!tfhd || tfhd.length < 8 || tfhd.readUInt32BE(4) !== track.id) continue;

    // tfhd: optional fields in flag order
    const tfhdFlags = tfhd.readUInt32BE(0) & 0xffffff;
    let at = 8;
    if (tfhdFlags & 0x01) at += 8;
    if (tfhdFlags & 0x02) at += 4;
    const defaultDuration =
      tfhdFlags & 0x08 && tfhd.length >= at + 4 ? tfhd.readUInt32BE(at) : track.defaultDuration;

    const tfdt = parts.find((box) => box.type === "tfdt")?.data;
    let time =
      tfdt && tfdt.length >= 8
        ? tfdt[0] === 1 && tfdt.length >= 12
          ? Number(tfdt.readBigUInt64BE(4))
          : tfdt.readUInt32BE(4)
        : (end ?? from);

    for (const trun of parts.filter((box) => box.type === "trun").map((box) => box.data)) {
      if (trun.length < 8) continue;
      const flags = trun.readUInt32BE(0) & 0xffffff;
      const count = trun.readUInt32BE(4);
      let offset = 8;
      if (flags & 0x01) offset += 4;
      if (flags & 0x04) offset += 4;

      const perSample = [0x100, 0x200, 0x400, 0x800].filter((flag) => flags & flag).length * 4;

      if (!(flags & 0x100)) {
        time += count * defaultDuration;
        continue;
      }

      for (let sample = 0; sample < count && offset + 4 <= trun.length; sample++) {
        time += trun.readUInt32BE(offset);
        offset += perSample;
      }
    }

    end = Math.max(end ?? 0, time);
  }

  return end;
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
    // Set once the moov is read; fragmentsEnd adds up a
    // fragmented file's fragments after it
    let parsed: Moov | null = null;
    let fragmentsEnd = 0;

    for (let count = 0; count < MAX_TOP_LEVEL_BOXES; count++) {
      const head = await read(offset, 16);
      // Past the last box (or unreadable): done
      if (!head) break;

      if ("whole" in head) {
        if (!head.whole) return null;
        const all = boxes(head.whole);
        const moov = all.find((box) => box.type === "moov");
        const parsed = moov ? readMoov(moov.data) : null;
        if (!parsed) return null;
        if (!parsed.fragmented || !parsed.track) return parsed.info;

        let end = 0;
        for (const moof of all.filter((box) => box.type === "moof")) {
          end = fragmentEnd(moof.data, parsed.track, end) ?? end;
        }
        return end ? { ...parsed.info, seconds: end / parsed.track.timescale } : parsed.info;
      }

      if (head.range.length < 8) break;

      let size = head.range.readUInt32BE(0);
      const type = head.range.toString("latin1", 4, 8);
      let header = 8;

      if (size === 1) {
        if (head.range.length < 16) return null;
        size = Number(head.range.readBigUInt64BE(8));
        header = 16;
      }
      // Runs to the end of the file: nothing after it
      if (size === 0 && type !== "moov") break;

      if (type === "moov") {
        if (size === 0 || size > MAX_MOOV_BYTES) return null;
        const moov = (await read(offset, size))?.range;
        if (!moov || moov.length < size) return null;
        parsed = readMoov(moov.subarray(header));
        if (!parsed) return null;
        // Usual files: the moov has the length
        if (!parsed.fragmented || !parsed.track) return parsed.info;
      } else if (type === "moof" && parsed?.track) {
        if (size > MAX_MOOF_BYTES) return parsed.info;
        const moof = (await read(offset, size))?.range;
        if (!moof || moof.length < size) return parsed.info;
        fragmentsEnd = fragmentEnd(moof.subarray(header), parsed.track, fragmentsEnd) ?? fragmentsEnd;
      }

      if (size < header) break;
      offset += size;
      // A size-0 box ran to the end of the file
      if (size === 0) break;
    }

    // Fragmented: the length is where the last one ends
    if (!parsed) return null;
    return parsed.track && fragmentsEnd
      ? { ...parsed.info, seconds: fragmentsEnd / parsed.track.timescale }
      : parsed.info;
  } catch (error) {
    console.error("Video measure failed:", url.host, error instanceof Error ? error.message : error);
    return null;
  }
}
