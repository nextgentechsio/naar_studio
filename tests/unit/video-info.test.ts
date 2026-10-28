import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { videoInfo } from "@/lib/storage/video-info";

// --------------------------------------------------
// Measuring a fragmented MP4 (what a browser's
// MediaRecorder writes, e.g. a video resized on upload):
// its real length is in the fragments, not the moov.
// --------------------------------------------------

const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
};

const u32 = (...values: number[]) => {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32BE(value, index * 4));
  return buffer;
};

// 482×850, track 1 at 30,000 units a second; `fragments`
// of `frames` frames, each 1,000 units (1/30 s) long. The
// moov's own length is 1 s, as a recorder writes it early.
function fragmentedMp4(fragments: number, frames: number, perSampleDurations: boolean): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(1000, 16);

  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(1, 12);
  tkhd.writeUInt32BE(482 * 65536, 76);
  tkhd.writeUInt32BE(850 * 65536, 80);

  const mdhd = u32(0, 0, 0, 30_000, 0, 0);
  // trex default duration: used when trun has none
  const trex = u32(0, 1, 1, 1000, 0, 0);

  const moov = box(
    "moov",
    box("mvhd", mvhd),
    box("trak", box("tkhd", tkhd), box("mdia", box("mdhd", mdhd))),
    box("mvex", box("trex", trex))
  );

  const parts = [box("ftyp", Buffer.from("isom0000", "latin1")), moov];

  for (let index = 0; index < fragments; index++) {
    const tfdt = Buffer.alloc(12);
    tfdt[0] = 1;
    tfdt.writeBigUInt64BE(BigInt(index * frames * 1000), 4);

    const trun = perSampleDurations
      ? Buffer.concat([u32(0x000300, frames), ...Array.from({ length: frames }, () => u32(1000, 10))])
      : u32(0x000200, frames, ...Array.from({ length: frames }, () => 10));

    parts.push(
      box("moof", box("mfhd", u32(0, index + 1)), box("traf", box("tfhd", u32(0, 1)), box("tfdt", tfdt), box("trun", trun)))
    );
    parts.push(box("mdat", Buffer.alloc(frames * 10)));
  }

  return Buffer.concat(parts);
}

const files = new Map<string, Buffer>();
let server: Server;
let base = "";

beforeAll(async () => {
  files.set("/durations.mp4", fragmentedMp4(4, 30, true));
  files.set("/defaults.mp4", fragmentedMp4(3, 45, false));

  server = createServer((req, res) => {
    const bytes = files.get(req.url ?? "");
    if (!bytes) {
      res.writeHead(404);
      return res.end();
    }

    const match = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? "");
    if (!match) {
      res.writeHead(200, { "content-length": bytes.length });
      return res.end(bytes);
    }

    const start = Number(match[1]);
    if (start >= bytes.length) {
      res.writeHead(416);
      return res.end();
    }
    const end = Math.min(Number(match[2]), bytes.length - 1);
    res.writeHead(206, { "content-range": `bytes ${start}-${end}/${bytes.length}` });
    res.end(bytes.subarray(start, end + 1));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const measure = (path: string) => videoInfo(new URL(`${base}${path}`), () => true);

describe("videoInfo on fragmented MP4s", () => {
  it("adds up the fragments' sample durations", async () => {
    // 4 × 30 frames of 1/30 s = 4 s (the moov says 1 s)
    expect(await measure("/durations.mp4")).toEqual({ width: 482, height: 850, seconds: 4 });
  });

  it("uses the track's default duration when samples have none", async () => {
    // 3 × 45 frames of 1/30 s = 4.5 s
    expect(await measure("/defaults.mp4")).toEqual({ width: 482, height: 850, seconds: 4.5 });
  });
});
