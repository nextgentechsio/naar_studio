import { createHash } from "node:crypto";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { getKeyGeneration, hasSavedOutput } from "@/lib/api-keys/generations";
import { openBlobOutput, openOutput, parseRange } from "@/lib/storage/generation-outputs";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// --------------------------------------------------
// GET the saved output file of one of this key's runs,
// streamed from our copy (Range requests supported).
// --------------------------------------------------

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  const generation = await getKeyGeneration(guard.caller.key, id);
  if (!generation || !hasSavedOutput(generation)) {
    return apiError("output_not_found", "This generation has no saved output (yet).", 404);
  }

  try {
    const size = generation.outputSize!;
    const etag = generation.outputBlobUrl
      ? `"${createHash("sha256").update(generation.outputBlobUrl).digest("hex").slice(0, 32)}"`
      : `"${generation.outputFileId!.toHexString()}"`;

    const headers: Record<string, string> = {
      "Content-Type": generation.outputContentType ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };

    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    const range = parseRange(request.headers.get("range"), size);
    if (range === "invalid") {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }

    const body = generation.outputBlobUrl
      ? await openBlobOutput(generation.outputBlobUrl, range)
      : await openOutput(generation.outputFileId!, range);

    if (range) {
      return new Response(body, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
      });
    }
    return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
  } catch (error) {
    console.error("API output error:", id, error);
    return apiError("server_error", "Couldn't read the output.", 500);
  }
}
