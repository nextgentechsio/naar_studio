import type { Metadata } from "next";
import ProductWorkspace from "./ProductWorkspace";

export const metadata: Metadata = { title: "Catalogue product" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductWorkspace id={id} />;
}
