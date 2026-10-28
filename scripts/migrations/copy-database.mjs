// --------------------------------------------------
// COPY THE DATABASE TO A NEW CLUSTER (records only)
//
// Copies every collection from MONGODB_URI (source, only
// read) to TARGET_MONGODB_URI, except the GridFS file
// buckets: files live in Vercel Blob now. Copied records
// lose their GridFS pointers (outputFileId, image.fileId),
// so the new database has no dependency on GridFS; the
// copy refuses to run if any record still needs one
// (see scripts/check-blob-dependencies.mjs).
//
// Re-runnable: it mirrors the source each time (upserts
// every record, removes records deleted at the source),
// so run it again right before switching MONGODB_URI.
//
//   node scripts/copy-database.mjs --dry-run
//   node scripts/copy-database.mjs
//
// TARGET_MONGODB_URI defaults to MONGO_MONGODB_URI (the
// Vercel integration's variable). Same database name
// (MONGODB_DB) on both sides.
// --------------------------------------------------

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(ROOT, true, { info() {}, error: console.error });

const SOURCE = process.env.MONGODB_URI;
const TARGET = process.env.TARGET_MONGODB_URI || process.env.MONGO_MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "ai_studio";
const DRY_RUN = process.argv.includes("--dry-run");

const isGridFs = (name) => /^(generationOutputs|projectImages)\.(files|chunks)$/.test(name);

// What a record looks like in the new database
function transform(collection, doc) {
  if (collection === "generations" && "outputFileId" in doc) {
    if (doc.outputFileId && !doc.outputBlobUrl) {
      throw new Error(`generation ${doc._id} has its output only in GridFS`);
    }
    return { ...doc, outputFileId: null };
  }

  if (collection === "projects" && doc.image) {
    if (doc.image.fileId && !doc.image.blobUrl) {
      throw new Error(`project ${doc.name} has its photo only in GridFS`);
    }
    return { ...doc, image: { ...doc.image, fileId: null } };
  }

  return doc;
}

const fingerprint = (docs) =>
  createHash("sha256")
    .update(JSON.stringify([...docs].sort((a, b) => String(a._id).localeCompare(String(b._id)))))
    .digest("hex");

async function main() {
  if (!SOURCE || !TARGET) throw new Error("MONGODB_URI and TARGET_MONGODB_URI (or MONGO_MONGODB_URI) must be set");
  if (SOURCE === TARGET) throw new Error("Source and target are the same cluster");

  const source = new MongoClient(SOURCE);
  const target = new MongoClient(TARGET);
  await Promise.all([source.connect(), target.connect()]);

  let mismatches = 0;

  try {
    const from = source.db(DB_NAME);
    const to = target.db(DB_NAME);

    const collections = (await from.listCollections({}, { nameOnly: true }).toArray())
      .map((item) => item.name)
      .filter((name) => !name.startsWith("system."));

    for (const name of collections.sort()) {
      if (isGridFs(name)) {
        console.log(`${name.padEnd(26)} skipped (files are in Blob)`);
        continue;
      }

      const docs = (await from.collection(name).find().toArray()).map((doc) => transform(name, doc));

      if (DRY_RUN) {
        console.log(`${name.padEnd(26)} ${docs.length} records to copy`);
        continue;
      }

      const coll = to.collection(name);

      if (docs.length) {
        await coll.bulkWrite(
          docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
          { ordered: false }
        );
      }

      // Mirror deletions made at the source since the last run
      const removed = await coll.deleteMany({ _id: { $nin: docs.map((doc) => doc._id) } });

      // Verify: same records, same content
      const copied = await coll.find().toArray();
      const same = copied.length === docs.length && fingerprint(copied) === fingerprint(docs);
      if (!same) mismatches += 1;

      console.log(
        `${name.padEnd(26)} ${String(copied.length).padStart(5)} records ${same ? "✓ identical" : "✗ MISMATCH"}${removed.deletedCount ? ` (${removed.deletedCount} removed)` : ""}`
      );
    }
  } finally {
    await Promise.all([source.close(), target.close()]);
  }

  if (DRY_RUN) console.log("Dry run: nothing copied.");
  else if (mismatches) {
    console.log(`\n✗ ${mismatches} collections differ`);
    process.exitCode = 1;
  } else console.log("\n✓ All records copied and verified. The source was not changed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
