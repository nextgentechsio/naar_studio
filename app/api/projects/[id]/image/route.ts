import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getProjectImage,
  openProjectImage,
  projectImageVersion,
  PROJECT_IMAGE_MAX_BYTES,
  removeProjectImage,
  setProjectImage,
} from "@/lib/project-images";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// Room for the multipart boundaries and headers
const MAX_REQUEST_BYTES = PROJECT_IMAGE_MAX_BYTES + 64 * 1024;

// Any signed-in user can view a project photo (the
// Generate page shows it). URLs are versioned by file
// id, so the browser may cache them for good.
export async function GET(
  request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const image = await getProjectImage(id);

    if (!image) {
      return NextResponse.json(
        { error: "No photo for this project" },
        { status: 404 }
      );
    }

    const version = projectImageVersion(image);
    const etag = `"${version}"`;

    // Only the current versioned URL is immutable; an
    // old or unversioned one must revalidate
    const current =
      new URL(request.url).searchParams.get("v") === version;

    const headers = {
      ETag: etag,
      "Cache-Control": current
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
      // Belt and braces: never let the browser treat the
      // bytes as anything but the sniffed image type
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };

    // Unchanged: answer before fetching any bytes
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    const stream = await openProjectImage(image);

    if (!stream) {
      return NextResponse.json(
        { error: "No photo for this project" },
        { status: 404 }
      );
    }

    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": image.contentType,
        "Content-Length": String(image.size),
      },
    });
  } catch (error) {
    console.error("Read project image error:", error);

    return NextResponse.json(
      { error: "Failed to load photo" },
      { status: 500 }
    );
  }
}

// Upload or replace the photo: multipart form with a
// single "file" field. Admins and the super admin, like
// other project edits.
export async function PUT(
  request: Request,
  context: RouteContext
) {
  const auth = await requireUser(["super_admin", "admin"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;

    // A body without a declared size (chunked) could be
    // any size, and formData() would buffer all of it
    const declared = Number(request.headers.get("content-length"));

    if (!declared) {
      return NextResponse.json(
        { error: "Upload size is required" },
        { status: 411 }
      );
    }

    if (declared > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Photo must be 5 MB or smaller" },
        { status: 413 }
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Choose a photo to upload" },
        { status: 400 }
      );
    }

    const result = await setProjectImage(
      id,
      new Uint8Array(await file.arrayBuffer())
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ imageUrl: result.imageUrl });
  } catch (error) {
    console.error("Upload project image error:", error);

    return NextResponse.json(
      { error: "Failed to upload photo" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser(["super_admin", "admin"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const result = await removeProjectImage(id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ imageUrl: null });
  } catch (error) {
    console.error("Remove project image error:", error);

    return NextResponse.json(
      { error: "Failed to remove photo" },
      { status: 500 }
    );
  }
}
