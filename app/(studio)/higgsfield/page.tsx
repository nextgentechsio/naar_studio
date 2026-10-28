import type { Metadata } from "next";
import { ActiveGenerate } from "@/app/(studio)/_generate/GenerateProvider";
import GenerateView from "@/app/(studio)/_generate/GenerateView";

export const metadata: Metadata = { title: "Higgsfield" };

// The Generate page, on the Higgsfield form and run
export default function Page() {
  return (
    <ActiveGenerate provider="higgsfield">
      <GenerateView />
    </ActiveGenerate>
  );
}
