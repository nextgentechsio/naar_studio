import type { ReactNode } from "react";
import PlatformGate from "@/app/(studio)/_components/PlatformGate";
import CatalogueTabs from "./_parts/CatalogueTabs";

export default function CatalogueLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformGate platform="catalogue">
      <div className="space-y-6">
        <CatalogueTabs />
        {children}
      </div>
    </PlatformGate>
  );
}
