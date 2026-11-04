import type { Metadata } from "next";
import AssistantView from "./AssistantView";

export const metadata: Metadata = { title: "Assistant" };

export default function Page() {
  return <AssistantView />;
}
