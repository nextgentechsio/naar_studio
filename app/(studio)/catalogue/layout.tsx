import type { ReactNode } from "react";
import CatalogueTabs from "./_parts/CatalogueTabs";

export default function CatalogueLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <CatalogueTabs />
      {children}
    </div>
  );
}
