import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { getBoard } from "@/lib/boards/server";
import BoardEditor from "./_editor/BoardEditor";
import "../boards.css";

export const metadata: Metadata = { title: "Board" };

// The board loads on the server, so the editor opens
// with everything already there
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const result = await getBoard(user, (await params).id);
  if (!result.ok) notFound();
  return (
    <BoardEditor
      key={result.value.board.id}
      board={result.value.board}
      initialItems={result.value.items}
      readOnly={result.value.readOnly}
    />
  );
}
