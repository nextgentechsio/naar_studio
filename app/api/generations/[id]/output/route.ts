import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createHash } from "crypto";
import { openBlobOutput, openOutput, parseRange } from "@/lib/storage/generation-outputs";
import { canViewGeneration, getGeneration } from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// A run's saved output, for its owner and managers only
// (anyone else gets 404, so ids can't be probed). Range
// requests are supported: Safari won't play video without
// them, and seeking needs them everywhere.
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const generation = await getGeneration(id);

    if (
      !generation ||
      !canViewGeneration(auth.user, generation) ||
      !(generation.outputBlobUrl || generation.outputFileId) ||
      typeof generation.outputSize !== "number"
    ) {
      return NextResponse.json({ error: "Output not found" }, { status: 404 });
    }

    const size = generation.outputSize;
    const etag = generation.outputBlobUrl
      ? `"${createHash("sha256").update(generation.outputBlobUrl).digest("hex").slice(0, 32)}"`
      : `"${generation.outputFileId!.toHexString()}"`;

    const headers: Record<string, string> = {
      "Content-Type": generation.outputContentType ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      ETag: etag,
      // The file for an id never changes
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    const range = parseRange(request.headers.get("range"), size);

    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
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

    return new Response(body, {
      headers: { ...headers, "Content-Length": String(size) },
    });
  } catch (error) {
    console.error("Read output error:", error);

    return NextResponse.json(
      { error: "Couldn't load this output" },
      { status: 500 }
    );
  }
}
