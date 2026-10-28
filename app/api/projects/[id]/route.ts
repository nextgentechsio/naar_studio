import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  deleteProject,
  updateProject,
} from "@/lib/projects";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  const auth = await requireUser(["super_admin", "admin"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const result = await updateProject(id, {
      name: body?.name,
      description: body?.description,
      status: body?.status,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ project: result.project });
  } catch (error) {
    console.error("Update project error:", error);

    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext
) {
  // Permanent delete: super admin only (admins archive)
  const auth = await requireUser(["super_admin"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;

    const result = await deleteProject(id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete project error:", error);

    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
