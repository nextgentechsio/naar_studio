import { deleteTemplate, updateTemplate } from "@/lib/catalogue/library";
import { catalogueRoute, jsonBody } from "@/lib/catalogue/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return catalogueRoute(async (user) => ({ template: await updateTemplate(user, id, await jsonBody(request)) }));
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  return catalogueRoute((user) => deleteTemplate(user, id));
}
