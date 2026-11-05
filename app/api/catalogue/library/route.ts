import { canEditLibrary, createAsset, listAssets, listTemplates } from "@/lib/catalogue/library";
import { catalogueRoute, jsonBody } from "@/lib/catalogue/http";

export const runtime = "nodejs";

// GET: models, poses, backgrounds, accessories and
// templates (archived ones too for admins, ?all=1)
// POST: a new library item (admins)
export async function GET(request: Request) {
  return catalogueRoute(async (user) => {
    const all = new URL(request.url).searchParams.get("all") === "1" && canEditLibrary(user);
    const [assets, templates] = await Promise.all([
      listAssets({ includeArchived: all }),
      listTemplates({ includeArchived: all }),
    ]);
    return { assets, templates, canEdit: canEditLibrary(user) };
  });
}

export async function POST(request: Request) {
  return catalogueRoute(async (user) => ({ asset: await createAsset(user, await jsonBody(request)) }));
}
