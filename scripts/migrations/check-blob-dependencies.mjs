// --------------------------------------------------
// CAN THE GRIDFS FILES GO? (read-only check)
//
// Before deleting the old file copies from MongoDB,
// confirm nothing still needs them:
//   - every generation with a saved output has a Blob
//     link (outputBlobUrl), and
//   - every project photo has a Blob link (image.blobUrl),
//   - and every one of those links answers with the
//     right size.
// Exit code 0 only when there are no dependencies left.
//
//   node scripts/migrations/check-blob-dependencies.mjs
// --------------------------------------------------

import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(ROOT, true, { info() {}, error: console.error });

// Asks for one byte: proves the file is there and gives
// its full size, without downloading it
async function blobSize(url) {
  const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  await response.arrayBuffer();
  if (response.status !== 206) return null;
  return Number((response.headers.get("content-range") || "").split("/")[1]);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const problems = [];

  try {
    const db = client.db(process.env.MONGODB_DB || "ai_studio");

    // Generations
    const generations = db.collection("generations");
    const gridOnly = await generations
      .find({ outputFileId: { $ne: null }, $or: [{ outputBlobUrl: null }, { outputBlobUrl: { $exists: false } }] })
      .project({ _id: 1 })
      .toArray();
    for (const doc of gridOnly) problems.push(`generation ${doc._id}: output only in GridFS`);

    const legacyFolder = await generations.countDocuments({ localOutputUrl: /^\/history\// });
    if (legacyFolder) console.log(`note: ${legacyFolder} very old records point at public/history (not GridFS, unaffected)`);

    const withBlob = await generations
      .find({ outputBlobUrl: { $ne: null } })
      .project({ outputBlobUrl: 1, outputSize: 1 })
      .toArray();
    for (const doc of withBlob) {
      const size = await blobSize(doc.outputBlobUrl);
      if (size !== doc.outputSize) problems.push(`generation ${doc._id}: Blob copy ${size === null ? "unreachable" : `is ${size} bytes, expected ${doc.outputSize}`}`);
    }

    // Project photos
    const projects = db.collection("projects");
    const photoGridOnly = await projects
      .find({ image: { $ne: null }, $or: [{ "image.blobUrl": null }, { "image.blobUrl": { $exists: false } }] })
      .project({ name: 1 })
      .toArray();
    for (const doc of photoGridOnly) problems.push(`project ${doc.name}: photo only in GridFS`);

    const photos = await projects
      .find({ "image.blobUrl": { $ne: null } })
      .project({ name: 1, "image.blobUrl": 1, "image.size": 1 })
      .toArray();
    for (const doc of photos) {
      const size = await blobSize(doc.image.blobUrl);
      if (size !== doc.image.size) problems.push(`project ${doc.name}: Blob photo ${size === null ? "unreachable" : `is ${size} bytes, expected ${doc.image.size}`}`);
    }

    console.log(`generations served from Blob: ${withBlob.length} (verified)`);
    console.log(`project photos served from Blob: ${photos.length} (verified)`);
  } finally {
    await client.close();
  }

  if (problems.length) {
    console.log(`\n${problems.length} dependencies on GridFS remain:`);
    for (const problem of problems) console.log(`  ✗ ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("\n✓ Nothing depends on GridFS. The old file copies can be removed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
