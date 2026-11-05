import type { Metadata } from "next";
import LibraryView from "./LibraryView";

export const metadata: Metadata = { title: "Catalogue library" };

export default function Page() {
  return <LibraryView />;
}
