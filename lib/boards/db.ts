import type { Collection, ObjectId } from "mongodb";
import { getDb } from "@/lib/db/mongodb";
import type { BoardItem } from "./shared";

// --------------------------------------------------
// NAAR BOARDS: COLLECTIONS
//
// Own collections and indexes, created here on first use
// (lib/db/mongodb.ts isn't touched).
// --------------------------------------------------

export type BoardDoc = {
  _id: ObjectId;
  name: string;
  ownerId: string;
  // The first image placed, for the boards list
  coverUrl: string | null;
  itemCount: number;
  // Bumped on every save (collaborators' "changes since")
  rev: number;
  // Made by "Import from Figma" (copies keep it)
  importedFrom?: "figma";
  createdAt: Date;
  updatedAt: Date;
};

// One per item: `${boardId}:${itemId}`
export type BoardItemDoc = BoardItem & {
  _id: string;
  boardId: string;
  rev: number;
  updatedAt: Date;
  updatedBy: string;
};

// Media copied into the board's own storage, once per
// source file per board
export type BoardAssetDoc = {
  _id: ObjectId;
  boardId: string;
  sourceUrl: string;
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  name: string;
  createdBy: string;
  createdAt: Date;
};

const globalForBoards = globalThis as unknown as { boardsSetupPromise?: Promise<void> };

async function setup() {
  const db = await getDb();
  await Promise.all([
    db.collection<BoardDoc>("boards").createIndexes([{ key: { ownerId: 1, updatedAt: -1 } }]),
    db.collection<BoardItemDoc>("boardItems").createIndexes([{ key: { boardId: 1, rev: 1 } }]),
    db.collection<BoardAssetDoc>("boardAssets").createIndexes([
      { key: { boardId: 1, sourceUrl: 1 }, unique: true },
      { key: { url: 1 } },
    ]),
  ]);
}

async function ready() {
  if (!globalForBoards.boardsSetupPromise) {
    globalForBoards.boardsSetupPromise = setup().catch((error) => {
      globalForBoards.boardsSetupPromise = undefined;
      throw error;
    });
  }
  await globalForBoards.boardsSetupPromise;
  return getDb();
}

export async function boardsCollection(): Promise<Collection<BoardDoc>> {
  return (await ready()).collection<BoardDoc>("boards");
}

export async function boardItemsCollection(): Promise<Collection<BoardItemDoc>> {
  return (await ready()).collection<BoardItemDoc>("boardItems");
}

export async function boardAssetsCollection(): Promise<Collection<BoardAssetDoc>> {
  return (await ready()).collection<BoardAssetDoc>("boardAssets");
}
