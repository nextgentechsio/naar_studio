import type { Metadata } from "next";
import ElementsView from "./ElementsView";

export const metadata: Metadata = { title: "Elements" };

export default function Page() {
  return <ElementsView />;
}
