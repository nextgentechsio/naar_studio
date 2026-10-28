import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  createProject,
  listProjects,
} from "@/lib/projects";
import { canManageProjects } from "@/lib/auth/roles";

export const runtime = "nodejs";

// Any signed-in user can list active projects (for the
// Generate page). ?all=1 includes archived ones, for the
// project managers (admins and the super admin) only.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);

    const includeArchived =
      searchParams.get("all") === "1" &&
      canManageProjects(auth.user);

    return NextResponse.json({
      projects: await listProjects({ includeArchived }),
    });
  } catch (error) {
    console.error("List projects error:", error);

    return NextResponse.json(
      { error: "Failed to load projects" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(["super_admin", "admin"]);
  if (auth.response) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));

    const result = await createProject(auth.user.id, {
      name: body?.name,
      description: body?.description,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { project: result.project },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create project error:", error);

    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
