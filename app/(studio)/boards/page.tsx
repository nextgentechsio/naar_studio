import type { Metadata } from "next";
import BoardsView from "./BoardsView";
import "./boards.css";

export const metadata: Metadata = { title: "Boards" };

export default function Page() {
  return <BoardsView />;
}
