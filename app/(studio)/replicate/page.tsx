import type { Metadata } from "next";
import GenerateView from "@/app/(studio)/_generate/GenerateView";

export const metadata: Metadata = { title: "Replicate" };

export default function Page() {
  return <GenerateView />;
}
