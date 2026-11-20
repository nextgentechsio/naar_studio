"use client";

import { fetchJson } from "@/lib/client/http";
import type { BoardItem, BoardOp, PublicBoard } from "@/lib/boards/shared";

// --------------------------------------------------
// NAAR BOARDS (browser only): API calls
// --------------------------------------------------

export type { BoardItem, BoardOp, PublicBoard };
export type BoardAsset = { url: string; contentType: string; name: string; size: number };

const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const path = (id: string, rest = "") => `/api/boards/${encodeURIComponent(id)}${rest}`;

// "all": everyone's boards (the super admin; the server checks)
export async function fetchBoards(scope: "mine" | "all" = "mine"): Promise<PublicBoard[]> {
  return (await fetchJson<{ boards: PublicBoard[] }>(`/api/boards${scope === "all" ? "?scope=all" : ""}`)).boards;
}

export async function createBoard(name?: string): Promise<PublicBoard> {
  return (await fetchJson<{ board: PublicBoard }>("/api/boards", { method: "POST", ...json({ name }) })).board;
}

export async function fetchBoard(id: string): Promise<{ board: PublicBoard; items: BoardItem[]; rev: number; readOnly: boolean }> {
  return fetchJson(path(id));
}

export async function renameBoard(id: string, name: string): Promise<PublicBoard> {
  return (await fetchJson<{ board: PublicBoard }>(path(id), { method: "PATCH", ...json({ name }) })).board;
}

export async function duplicateBoard(id: string): Promise<PublicBoard> {
  return (await fetchJson<{ board: PublicBoard }>(path(id, "/duplicate"), { method: "POST" })).board;
}

export async function deleteBoard(id: string): Promise<void> {
  await fetchJson(path(id), { method: "DELETE" });
}

export async function saveBoardOps(id: string, ops: BoardOp[], keepalive = false): Promise<{ rev: number }> {
  return fetchJson(path(id, "/ops"), { method: "POST", keepalive, ...json({ ops }) });
}

export async function addBoardAsset(id: string, url: string): Promise<BoardAsset> {
  return (await fetchJson<{ asset: BoardAsset }>(path(id, "/assets"), { method: "POST", ...json({ url }) })).asset;
}
