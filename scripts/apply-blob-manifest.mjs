// --------------------------------------------------
// POINT GENERATION RECORDS AT THEIR BLOB COPIES
//
// Step two of moving outputs out of MongoDB, after
// scripts/copy-files-to-blob.mjs. For every output in
// the manifest it sets `outputBlobUrl` on the matching
// generation, and only when that record still points
// at the very same GridFS file with the same size.
// From then on the app serves that output from Blob.
//
// Additive only: no GridFS file is deleted and no other
// field changes, so the app keeps working either way.
// Undo: unset outputBlobUrl on those records.
//
//   node scripts/apply-blob-manifest.mjs --dry-run
//   node scripts/apply-blob-manifest.mjs
// --------------------------------------------------

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { MongoClient, ObjectId } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(ROOT, true, { info() {}, error: console.error });

const MANIFEST = process.env.BLOB_MANIFEST_PATH || path.join(ROOT, ".migration/blob-manifest.json");
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const outputs = Object.values(manifest.files).filter((file) => file.bucket === "generationOutputs");

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  const totals = { applied: 0, already: 0, skipped: 0 };

  try {
    const generations = client.db(process.env.MONGODB_DB || "ai_studio").collection("generations");

    for (const file of outputs) {
      const match = {
        _id: file.owner,
        outputFileId: new ObjectId(file.gridFsId),
        outputSize: file.size,
      };

      const record = await generations.findOne(match, { projection: { outputBlobUrl: 1 } });

      if (!record) {
        // Expired, re-run or otherwise changed since the copy
        totals.skipped += 1;
        console.log(`  - ${file.owner}: no matching record, skipped`);
        continue;
      }

      if (record.outputBlobUrl) {
        totals.already += 1;
        continue;
      }

      if (!DRY_RUN) {
        const result = await generations.updateOne(
          { ...match, $or: [{ outputBlobUrl: null }, { outputBlobUrl: { $exists: false } }] },
          { $set: { outputBlobUrl: file.blobUrl } }
        );
        if (result.modifiedCount !== 1) {
          totals.skipped += 1;
          console.log(`  - ${file.owner}: changed meanwhile, skipped`);
          continue;
        }
      }

      totals.applied += 1;
    }
  } finally {
    await client.close();
  }

  console.log(
    `${DRY_RUN ? "Dry run: would point" : "Pointed"} ${totals.applied} records at Blob; ${totals.already} already did, ${totals.skipped} skipped (of ${outputs.length} outputs in the manifest).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
