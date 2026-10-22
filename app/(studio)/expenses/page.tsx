import type { Metadata } from "next";
import { Suspense } from "react";
import ExpensesView from "./ExpensesView";

export const metadata: Metadata = { title: "Expenses" };

// ExpensesView reads filters from the URL
// (useSearchParams), which needs a Suspense boundary
export default function Page() {
  return (
    <Suspense>
      <ExpensesView />
    </Suspense>
  );
}
