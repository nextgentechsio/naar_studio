import { createTemplate } from "@/lib/catalogue/library";
import { catalogueRoute, jsonBody } from "@/lib/catalogue/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return catalogueRoute(async (user) => ({ template: await createTemplate(user, await jsonBody(request)) }));
}
