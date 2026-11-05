import type { Metadata } from "next";
import GenerateView from "@/app/(studio)/_generate/GenerateView";
import PlatformGate from "@/app/(studio)/_components/PlatformGate";

export const metadata: Metadata = { title: "Replicate" };

export default function Page() {
  return (
    <PlatformGate platform="replicate">
      <GenerateView />
    </PlatformGate>
  );
}
