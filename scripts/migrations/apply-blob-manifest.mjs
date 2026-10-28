// --------------------------------------------------
// POINT RECORDS AT THEIR BLOB COPIES
//
// Step two of moving files out of MongoDB, after
// scripts/migrations/copy-files-to-blob.mjs. From the manifest it
// sets `outputBlobUrl` on generations and
// `image.blobUrl` on projects, only where the record
// still points at the very same GridFS file with the
// same size. From then on the app serves them from Blob.
//
// Additive only: no GridFS file is deleted and no other
// field changes, so the app keeps working either way.
// Undo: unset those fields.
//
//   node scripts/migrations/apply-blob-manifest.mjs --dry-run
//   node scripts/migrations/apply-blob-manifest.mjs
// --------------------------------------------------

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { MongoClient, ObjectId } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(ROOT, true, { info() {}, error: console.error });

const MANIFEST = process.env.BLOB_MANIFEST_PATH || path.join(ROOT, ".migration/blob-manifest.json");
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const outputs = Object.values(manifest.files).filter((file) => file.bucket === "generationOutputs");
  const photos = Object.values(manifest.files).filter((file) => file.bucket === "projectImages");

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  const totals = { applied: 0, already: 0, skipped: 0 };
  const photoTotals = { applied: 0, already: 0, skipped: 0 };

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

    const projects = client.db(process.env.MONGODB_DB || "ai_studio").collection("projects");

    for (const file of photos) {
      const match = {
        _id: file.owner,
        "image.fileId": new ObjectId(file.gridFsId),
        "image.size": file.size,
      };

      const project = await projects.findOne(match, { projection: { "image.blobUrl": 1 } });

      if (!project) {
        photoTotals.skipped += 1;
        console.log(`  - project ${file.owner}: photo changed or removed, skipped`);
        continue;
      }

      if (project.image?.blobUrl) {
        photoTotals.already += 1;
        continue;
      }

      if (!DRY_RUN) {
        const result = await projects.updateOne(
          { ...match, $or: [{ "image.blobUrl": null }, { "image.blobUrl": { $exists: false } }] },
          { $set: { "image.blobUrl": file.blobUrl } }
        );
        if (result.modifiedCount !== 1) {
          photoTotals.skipped += 1;
          console.log(`  - project ${file.owner}: changed meanwhile, skipped`);
          continue;
        }
      }

      photoTotals.applied += 1;
    }
  } finally {
    await client.close();
  }

  console.log(
    `${DRY_RUN ? "Dry run: would point" : "Pointed"} ${totals.applied} generations at Blob; ${totals.already} already did, ${totals.skipped} skipped (of ${outputs.length} outputs in the manifest).`
  );
  console.log(
    `${DRY_RUN ? "Dry run: would point" : "Pointed"} ${photoTotals.applied} project photos at Blob; ${photoTotals.already} already did, ${photoTotals.skipped} skipped (of ${photos.length} in the manifest).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
