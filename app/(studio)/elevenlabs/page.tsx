import type { Metadata } from "next";
import { ActiveGenerate } from "@/app/(studio)/_generate/GenerateProvider";
import GenerateView from "@/app/(studio)/_generate/GenerateView";

export const metadata: Metadata = { title: "ElevenLabs" };

// The Generate page, on the ElevenLabs form and run
export default function Page() {
  return (
    <ActiveGenerate provider="elevenlabs">
      <GenerateView />
    </ActiveGenerate>
  );
}
