import http from "http";
import type { AddressInfo } from "net";

// --------------------------------------------------
// FAKE REPLICATE API
//
// Just enough of api.replicate.com for the app: models
// (with an input schema), predictions, cancel, files and
// search. Also a minimal Vercel Blob API (list, delete). Tests steer it through /__control endpoints,
// e.g. "this prediction has now succeeded".
//
// Special model names: */missing → 404, */reject → 422,
// */badtoken → 401 (our token rejected).
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

// Format: vercel_blob_rw_<storeId>_<secret>
export const FAKE_BLOB_TOKEN = "vercel_blob_rw_teststore_secret123";

export async function startFakeReplicate() {
  const predictions = new Map<string, Prediction>();
  const requests: { method: string; path: string; body: unknown; bytes: number }[] = [];
  let counter = 0;
  let blobs: { url: string; pathname: string; size: number; uploadedAt: string }[] = [];
  const blobRequests: { method: string; path: string; body: unknown }[] = [];
  // Multipart upload id → bytes received so far
  const multipart = new Map<string, number>();

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
      const stored = (bytes: number) => {
        const name = pathname.replace(/(\.[^.]+)?$/, "-rnd$1");
        const blob = {
          url: `https://teststore.public.blob.vercel-storage.com/${name}`,
          pathname: name,
          size: bytes,
          uploadedAt: new Date().toISOString(),
        };
        blobs.push(blob);
        return send(200, { ...blob, downloadUrl: blob.url, contentType: req.headers["x-content-type"] ?? "", contentDisposition: "inline" });
      };

      // Single upload
      if (path === "/blob/" && req.method === "PUT" && clientToken) {
        return stored(raw.length);
      }

      // Multipart: create → upload parts → complete
      if (path === "/blob/mpu" && clientToken) {
        const action = req.headers["x-mpu-action"];
        const id = String(req.headers["x-mpu-upload-id"] ?? "");

        if (action === "create") {
          const uploadId = `mpu-${++counter}`;
          multipart.set(uploadId, 0);
          return send(200, { key: `key-${uploadId}`, uploadId });
        }
        if (action === "upload" && multipart.has(id)) {
          multipart.set(id, multipart.get(id)! + raw.length);
          return send(200, { etag: `etag-${req.headers["x-mpu-part-number"]}` });
        }
        if (action === "complete" && multipart.has(id)) {
          const total = multipart.get(id)!;
          multipart.delete(id);
          return stored(total);
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
        blobs = blobs.filter((blob) => !urls.includes(blob.url));
        return send(200, {});
      }

      return send(404, { error: { code: "not_found", message: "No fake" } });
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
