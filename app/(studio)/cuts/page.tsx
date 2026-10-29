import type { Metadata } from "next";
import CutsView from "./CutsView";

export const metadata: Metadata = { title: "Naar Cuts" };

export default function Page() {
  return <CutsView />;
}
