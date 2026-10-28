import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardView from "./DashboardView";

export const metadata: Metadata = { title: "Dashboard" };

// DashboardView reads the platform from the URL
// (useSearchParams), which needs a Suspense boundary
export default function Page() {
  return (
    <Suspense>
      <DashboardView />
    </Suspense>
  );
}
