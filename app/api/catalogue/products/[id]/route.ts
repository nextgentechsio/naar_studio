import { deleteProduct, getProduct, updateProduct } from "@/lib/catalogue/products";
import { catalogueRoute, jsonBody } from "@/lib/catalogue/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

// GET also brings its unfinished shots up to date (the
// page polls it while anything is generating)
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return catalogueRoute(async (user) => ({ product: await getProduct(user, id) }));
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return catalogueRoute(async (user) => ({ product: await updateProduct(user, id, await jsonBody(request)) }));
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  return catalogueRoute((user) => deleteProduct(user, id));
}
