import type { Metadata } from "next";
import GenerateView from "./GenerateView";

export const metadata: Metadata = { title: "Generate" };

export default function Page() {
  return <GenerateView />;
}
