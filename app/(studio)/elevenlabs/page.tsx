import type { Metadata } from "next";
import { ActiveGenerate } from "@/app/(studio)/_generate/GenerateProvider";
import GenerateView from "@/app/(studio)/_generate/GenerateView";
import PlatformGate from "@/app/(studio)/_components/PlatformGate";

export const metadata: Metadata = { title: "ElevenLabs" };

// The Generate page, on the ElevenLabs form and run
export default function Page() {
  return (
    <PlatformGate platform="elevenlabs">
      <ActiveGenerate provider="elevenlabs">
        <GenerateView />
      </ActiveGenerate>
    </PlatformGate>
  );
}
