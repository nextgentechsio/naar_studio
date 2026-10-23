import http from "http";
import type { AddressInfo } from "net";

// --------------------------------------------------
// FAKE REPLICATE API
//
// Just enough of api.replicate.com for the app: models
// (with an input schema), predictions, cancel, files and
// search. Also a minimal Vercel Blob API (uploads,
// multipart, list, delete) that serves stored files. Tests steer it through /__control endpoints,
// e.g. "this prediction has now succeeded".
//
// Special model names: */missing → 404, */reject → 422,
// */badtoken → 401 (our token rejected).
//
// A fake Higgsfield API lives under /hf (requests and
// their status, steered via /__control/hf/<id>). Prompts
// containing "nocredits" get a 403, "reject" a 422.
// --------------------------------------------------

type Prediction = Record<string, unknown> & { id: string; status: string };

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

const SCHEMA = {
  components: {
    schemas: {
      Input: {
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          image: { type: "string", format: "uri" },
          image_input: { type: "array", items: { type: "string" } },
          seed: { type: "integer" },
          resolution: { type: "string" },
          duration: { type: "integer" },
        },
      },
    },
  },
};

export const FAKE_HF_CREDENTIALS = "fake-id:fake-secret";

// A few of Higgsfield's models, with real-shaped schemas
const HF_MODELS = [
  {
    slug: "bytedance/seedance-2.5/text-to-video",
    title: "Seedance 2.5",
    description: "Text to video",
    operation_type: ["text2video"],
    output_type: "video",
    base_credits: "0.0000",
    is_workflow: false,
    input_schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", minLength: 1 },
        duration: { type: "integer", default: 5, minimum: 4, maximum: 30 },
        resolution: { type: "string", enum: ["480p", "720p", "1080p"], default: "720p" },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" },
        generate_audio: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    slug: "bytedance/seedance-2.5/video-edit",
    title: "Seedance 2.5",
    description: "Video edit",
    operation_type: ["video2video"],
    output_type: "video",
    base_credits: "0.0000",
    is_workflow: false,
    input_schema: {
      type: "object",
      required: ["prompt", "video_url"],
      properties: {
        prompt: { type: "string", minLength: 1 },
        video_url: { type: "string", format: "uri" },
        resolution: { type: "string", enum: ["480p", "720p", "1080p"], default: "720p" },
      },
      additionalProperties: false,
    },
  },
  {
    slug: "higgsfield-ai/soul/v2/image-to-image",
    title: "Soul 2",
    description: "Image to image",
    operation_type: ["image_edit", "text2image"],
    output_type: "image",
    base_credits: "0.0000",
    is_workflow: false,
    input_schema: {
      type: "object",
      required: ["prompt", "image_urls"],
      properties: {
        prompt: { type: "string" },
        image_urls: { type: "array", items: { type: "string", format: "uri" } },
        seed: { type: ["integer", "null"] },
        // Nested: not shown in the form, never sent
        multi_prompt: { type: "array", items: { type: "object" } },
      },
    },
  },
];

// Format: vercel_blob_rw_<storeId>_<secret>
export const FAKE_BLOB_TOKEN = "vercel_blob_rw_teststore_secret123";

// A minimal MP4: ftyp, mdat, then moov (mvhd and one
// video track's tkhd), enough for the app to read the
// video's size and length
export function fakeMp4(width: number, height: number, seconds: number): Buffer {
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
  };
  const timescale = 1000;

  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(seconds * timescale, 16);

  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(seconds * timescale, 20);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);

  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000", "latin1")),
    box("mdat", Buffer.alloc(1024)),
    box("moov", box("mvhd", mvhd), box("trak", box("tkhd", tkhd))),
  ]);
}

// What /__control/output.mp4 serves (a 720×960, 5s video)
export const FAKE_OUTPUT_MP4 = fakeMp4(720, 960, 5);
// What /__control/input.mp4 serves (a 3s input video)
export const FAKE_INPUT_MP4 = fakeMp4(1280, 720, 3);

// Bytes, honouring a "Range: bytes=a-b" header
function serveBytes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bytes: Buffer,
  headers: Record<string, string> = {}
) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
      "content-length": String(end - start + 1),
    });
    return res.end(bytes.subarray(start, end + 1));
  }

  res.writeHead(200, { ...headers, "content-length": String(bytes.length) });
  return res.end(bytes);
}

export async function startFakeReplicate() {
  const predictions = new Map<string, Prediction>();
  const hfRequests = new Map<string, Record<string, unknown>>();
  const requests: { method: string; path: string; body: unknown; bytes: number }[] = [];
  let counter = 0;
  let blobs: { url: string; pathname: string; size: number; uploadedAt: string }[] = [];
  const blobRequests: { method: string; path: string; body: unknown }[] = [];
  // Stored bytes, served at /blobfiles/<pathname>
  const blobBytes = new Map<string, Buffer>();
  // Multipart upload id → parts received so far
  const multipart = new Map<string, Map<number, Buffer>>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const path = url.pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);

    let body: unknown = null;
    if (req.headers["content-type"]?.includes("application/json")) {
      try {
        body = JSON.parse(raw.toString() || "null");
      } catch {
        body = null;
      }
    }

    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // ---------- fake Vercel Blob API (/blob) ----------

    if (path === "/blob" || path.startsWith("/blob/")) {
      // The browser uploads here directly (another origin)
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "*");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE");
      res.setHeader("access-control-expose-headers", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      blobRequests.push({ method: req.method ?? "", path: path + url.search, body });

      const auth = req.headers.authorization ?? "";
      const serverToken = auth === `Bearer ${FAKE_BLOB_TOKEN}`;
      // Tokens the app signed for a browser upload
      const clientToken = auth.startsWith("Bearer vercel_blob_client_teststore_");

      if (!serverToken && !clientToken) {
        return send(403, { error: { code: "forbidden", message: "Bad token" } });
      }

      const pathname = url.searchParams.get("pathname") ?? "";
      const stored = (bytes: Buffer) => {
        const name = pathname.replace(/(\.[^.]+)?$/, `-rnd${++counter}$1`);
        const { port } = server.address() as AddressInfo;
        const blob = {
          url: `http://127.0.0.1:${port}/blobfiles/${name}`,
          pathname: name,
          size: bytes.length,
          uploadedAt: new Date().toISOString(),
        };
        blobs.push(blob);
        blobBytes.set(name, bytes);
        return send(200, { ...blob, downloadUrl: blob.url, contentType: req.headers["x-content-type"] ?? "", contentDisposition: "inline" });
      };

      // Single upload
      if (path === "/blob/" && req.method === "PUT") {
        return stored(raw);
      }

      // Multipart: create → upload parts → complete
      if (path === "/blob/mpu") {
        const action = req.headers["x-mpu-action"];
        const id = String(req.headers["x-mpu-upload-id"] ?? "");

        if (action === "create") {
          const uploadId = `mpu-${++counter}`;
          multipart.set(uploadId, new Map());
          return send(200, { key: `key-${uploadId}`, uploadId });
        }
        if (action === "upload" && multipart.has(id)) {
          multipart.get(id)!.set(Number(req.headers["x-mpu-part-number"]), raw);
          return send(200, { etag: `etag-${req.headers["x-mpu-part-number"]}` });
        }
        if (action === "complete" && multipart.has(id)) {
          const parts = [...multipart.get(id)!.entries()].sort(([a], [b]) => a - b);
          multipart.delete(id);
          return stored(Buffer.concat(parts.map(([, part]) => part)));
        }
      }

      if (!serverToken) {
        return send(403, { error: { code: "forbidden", message: "Client tokens can only upload" } });
      }

      if (path === "/blob" && req.method === "GET") {
        const prefix = url.searchParams.get("prefix") ?? "";
        return send(200, {
          blobs: blobs.filter((blob) => blob.pathname.startsWith(prefix)),
          hasMore: false,
        });
      }

      if (path === "/blob/delete" && req.method === "POST") {
        const urls = (body as { urls?: string[] })?.urls ?? [];
        for (const blob of blobs) {
          if (urls.includes(blob.url)) blobBytes.delete(blob.pathname);
        }
        blobs = blobs.filter((blob) => !urls.includes(blob.url));
        return send(200, {});
      }

      return send(404, { error: { code: "not_found", message: "No fake" } });
    }

    // Public blob links (what a browser or the app fetches)
    if (path.startsWith("/blobfiles/") && req.method === "GET") {
      const bytes = blobBytes.get(decodeURIComponent(path.slice("/blobfiles/".length)));
      if (!bytes) return send(404, { error: "Not found" });

      return serveBytes(req, res, bytes);
    }

    // ---------- fake Higgsfield API (/hf) ----------

    if (path.startsWith("/hf/")) {
      requests.push({ method: req.method ?? "", path, body, bytes: raw.length });

      if (req.headers.authorization !== `Key ${FAKE_HF_CREDENTIALS}`) {
        return send(401, { detail: "Invalid credentials" });
      }

      const hfStatus = path.match(/^\/hf\/requests\/([^/]+)\/(status|cancel)$/);
      if (hfStatus) {
        const id = decodeURIComponent(hfStatus[1]);
        const request = hfRequests.get(id);
        if (!request) return send(404, { detail: "Not found" });
        if (hfStatus[2] === "cancel" && req.method === "POST") request.status = "canceled";
        return send(200, request);
      }

      if (path === "/hf/models" && req.method === "GET") {
        return send(200, { total: HF_MODELS.length, items: HF_MODELS });
      }

      // Price quotes: Seedance is metered (described, not
      // quoted); a "noquote" prompt can't be quoted
      if (path.startsWith("/hf/estimate/") && req.method === "POST") {
        const model = path.slice("/hf/estimate/".length);
        const prompt = String((body as { prompt?: unknown })?.prompt ?? "");

        if (model.startsWith("bytedance/seedance")) {
          return send(200, { type: "description", pricing_description: "Token-metered pricing." });
        }
        if (prompt.includes("noquote")) return send(400, { detail: "Cannot estimate" });

        return send(200, { type: "estimate", credits: "0.064", usd: "0.004", discount: null });
      }

      if (req.method === "POST") {
        const prompt = String((body as { prompt?: unknown })?.prompt ?? "");
        if (prompt.includes("nocredits")) return send(403, { detail: "Not enough credits" });
        if (prompt.includes("reject")) return send(422, { detail: "duration: must be at most 30" });

        const id = `hf-${Date.now().toString(36)}-${++counter}`;
        const request = {
          status: "queued",
          request_id: id,
          status_url: `${url.origin}/hf/requests/${id}/status`,
          cancel_url: `${url.origin}/hf/requests/${id}/cancel`,
          model: path.slice("/hf/".length),
          input: body,
        };
        hfRequests.set(id, request);
        return send(200, request);
      }

      return send(404, { detail: `No fake for ${req.method} ${path}` });
    }

    const hfControl = path.match(/^\/__control\/hf\/([^/]+)$/);
    if (hfControl && req.method === "POST") {
      const id = decodeURIComponent(hfControl[1]);
      const existing = hfRequests.get(id) ?? { request_id: id, status: "queued" };
      hfRequests.set(id, { ...existing, ...(body as object) });
      return send(200, hfRequests.get(id));
    }

    if (path === "/__control/output.mp4") {
      return serveBytes(req, res, FAKE_OUTPUT_MP4, { "content-type": "video/mp4" });
    }

    if (path === "/__control/input.mp4") {
      return serveBytes(req, res, FAKE_INPUT_MP4, { "content-type": "video/mp4" });
    }

    if (path === "/__control/blobs") {
      if (req.method === "POST") blobs = body as typeof blobs;
      return send(200, { blobs, requests: blobRequests });
    }

    if (!path.startsWith("/__control")) {
      requests.push({ method: req.method ?? "", path, body, bytes: raw.length });

      if (req.headers.authorization !== "Bearer test-token") {
        return send(401, { detail: "Invalid token" });
      }
    }

    // ---------- control ----------

    // A download that dies partway: promises `declared`
    // bytes, sends 1 KB, then drops the connection
    if (path === "/__control/broken.png") {
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": url.searchParams.get("declared") ?? "1048576",
      });
      res.write(Buffer.alloc(1024));
      setTimeout(() => res.destroy(), 50);
      return;
    }

    if (path === "/__control/output.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }

    if (path === "/__control/requests") {
      return send(200, requests);
    }

    const control = path.match(/^\/__control\/predictions\/([^/]+)$/);
    if (control && req.method === "POST") {
      const id = decodeURIComponent(control[1]);
      const existing = predictions.get(id) ?? { id, status: "starting" };
      predictions.set(id, { ...existing, ...(body as object) });
      return send(200, predictions.get(id));
    }

    if (control && req.method === "DELETE") {
      predictions.delete(decodeURIComponent(control[1]));
      return send(200, {});
    }

    // ---------- API (/v1/...) ----------

    const model = path.match(/^\/v1\/models\/([^/]+)\/([^/]+)$/);
    if (model && req.method === "GET") {
      const name = model[2];
      if (name === "missing") return send(404, { detail: "Not found" });
      if (name === "badtoken") return send(401, { detail: "Invalid token" });

      return send(200, {
        owner: model[1],
        name,
        description: "fake",
        latest_version: { id: "version-1", openapi_schema: SCHEMA },
      });
    }

    const create = path.match(/^\/v1\/models\/([^/]+)\/([^/]+)\/predictions$/);
    if (create && req.method === "POST") {
      if (create[2] === "reject") {
        return send(422, { detail: "Input validation failed: seed must be an integer" });
      }

      const id = `test-${Date.now().toString(36)}-${++counter}`;
      const prediction: Prediction = {
        id,
        status: "starting",
        model: `${create[1]}/${create[2]}`,
        version: "version-1",
        input: (body as { input?: unknown })?.input ?? {},
        created_at: new Date().toISOString(),
      };
      predictions.set(id, prediction);
      return send(201, prediction);
    }

    const cancel = path.match(/^\/v1\/predictions\/([^/]+)\/cancel$/);
    if (cancel && req.method === "POST") {
      const prediction = predictions.get(decodeURIComponent(cancel[1]));
      if (!prediction) return send(404, { detail: "Not found" });
      prediction.status = "canceled";
      return send(200, prediction);
    }

    const get = path.match(/^\/v1\/predictions\/([^/]+)$/);
    if (get && req.method === "GET") {
      const prediction = predictions.get(decodeURIComponent(get[1]));
      return prediction ? send(200, prediction) : send(404, { detail: "Not found" });
    }

    if (path === "/v1/files" && req.method === "POST") {
      return send(201, { urls: { get: `https://replicate.delivery/fake/${++counter}.png` } });
    }

    if (path === "/v1/search") {
      return send(200, {
        models: [
          { model: { owner: "fake", name: "rare", run_count: 5 } },
          { model: { owner: "google", name: "nano-banana", run_count: 100 } },
          { model: { owner: "fake", name: "popular", run_count: 9000, cover_image_url: "http://insecure/x.png" } },
          { metadata: {} },
        ],
      });
    }

    if (path === "/v1/collections") {
      return send(200, {
        results: [
          { slug: "upscale", name: "Upscale images", description: "Make images bigger" },
          { slug: "official", name: "Official models", description: "Always on" },
        ],
      });
    }

    const collection = path.match(/^\/v1\/collections\/([^/]+)$/);
    if (collection) {
      if (collection[1] === "missing") return send(404, { detail: "Not found" });

      return send(200, {
        slug: collection[1],
        models: [
          { owner: "someone", name: "small", run_count: 10, cover_image_url: "https://img/s.png" },
          { owner: "philz1337x", name: "crystal-upscaler", run_count: 50 },
          { owner: "someone", name: "big", run_count: 5000 },
        ],
      });
    }

    send(404, { detail: `No fake for ${req.method} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
