import { createProduct, listProducts } from "@/lib/catalogue/products";
import { catalogueRoute, jsonBody } from "@/lib/catalogue/http";

export const runtime = "nodejs";

export async function GET() {
  return catalogueRoute(async (user) => ({ products: await listProducts(user) }));
}

export async function POST(request: Request) {
  return catalogueRoute(async (user) => ({ product: await createProduct(user, await jsonBody(request)) }));
}
