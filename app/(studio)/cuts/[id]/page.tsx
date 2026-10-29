import type { Metadata } from "next";
import EditorLoader from "./EditorLoader";

export const metadata: Metadata = { title: "Naar Cuts" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorLoader cutId={id} />;
}
