import type { Metadata } from "next";
import { Suspense } from "react";
import ProductsView from "./ProductsView";

export const metadata: Metadata = { title: "Catalogue" };

// ProductsView reads ?project= (the project being viewed)
export default function Page() {
  return (
    <Suspense>
      <ProductsView />
    </Suspense>
  );
}
