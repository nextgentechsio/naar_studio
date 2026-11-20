import { requireUser } from "@/lib/auth/auth";
import { openBoardFile } from "@/lib/boards/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// GET ?url=<board file>[&download=1]: one of the board's own files, served from
// this app's address (so the browser can save it, or draw it into a PNG export)
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  try {
    const result = await openBoardFile(auth.user, (await context.params).id, params.get("url"));
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    const { body, contentType, name, size } = result.value;
    const safeName = name.replace(/[^\w.-]+/g, "_") || "file";
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        ...(size ? { "Content-Length": String(size) } : {}),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ...(params.get("download") ? { "Content-Disposition": `attachment; filename="${safeName}"` } : {}),
      },
    });
  } catch (error) {
    console.error("Board file error:", error);
    return Response.json({ error: "Couldn't read that file" }, { status: 500 });
  }
}
