import type { Metadata } from "next";
import HiggsfieldView from "./HiggsfieldView";

export const metadata: Metadata = { title: "Higgsfield" };

export default function Page() {
  return <HiggsfieldView />;
}
