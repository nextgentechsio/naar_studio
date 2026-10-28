// --------------------------------------------------
// COPY SAVED FILES FROM MONGODB (GridFS) TO VERCEL BLOB
//
// Step one of moving file storage out of MongoDB. This
// script only READS MongoDB: nothing there is updated or
// deleted. Each file is uploaded to Blob, downloaded
// back and checked (size + SHA-256), then recorded in a
// local manifest, which the later switch-over uses to
// point records at Blob.
//
// Safe to re-run: files already in the manifest (same
// GridFS id and size) are skipped, so a second run just
// before the switch-over picks up anything new.
//
//   node scripts/migrations/copy-files-to-blob.mjs --dry-run
//   node scripts/migrations/copy-files-to-blob.mjs
//
// Reads MONGODB_URI, MONGODB_DB and BLOB_READ_WRITE_TOKEN
// from .env.local the same way Next.js does. Manifest:
// .migration/blob-manifest.json (git-ignored: it holds
// the unguessable Blob links).
// --------------------------------------------------

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { put } from "@vercel/blob";
import { GridFSBucket, MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(ROOT, true, { info() {}, error: console.error });

const MANIFEST = process.env.BLOB_MANIFEST_PATH || path.join(ROOT, ".migration/blob-manifest.json");
const DRY_RUN = process.argv.includes("--dry-run");

// GridFS bucket → Blob folder
const BUCKETS = [
  { bucket: "generationOutputs", folder: "outputs" },
  { bucket: "projectImages", folder: "project-images" },
];

const EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, files: {} };
    throw error;
  }
}

// Write-then-rename, so a crash never leaves a half file
async function saveManifest(manifest) {
  await mkdir(path.dirname(MANIFEST), { recursive: true });
  const temp = `${MANIFEST}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temp, MANIFEST);
}

async function readGridFsFile(bucket, id) {
  const chunks = [];
  for await (const chunk of bucket.openDownloadStream(id)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  for (const name of ["MONGODB_URI", "BLOB_READ_WRITE_TOKEN"]) {
    if (!process.env[name]) throw new Error(`${name} is not set`);
  }

  const manifest = await loadManifest();
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  const totals = { copied: 0, skipped: 0, failed: 0, bytes: 0 };

  try {
    const db = client.db(process.env.MONGODB_DB || "ai_studio");

    for (const { bucket: bucketName, folder } of BUCKETS) {
      const bucket = new GridFSBucket(db, { bucketName });
      const files = await bucket.find({}, { sort: { uploadDate: 1 } }).toArray();
      const todo = files.filter((file) => {
        const done = manifest.files[file._id.toHexString()];
        return !(done && done.size === file.length);
      });

      console.log(
        `${bucketName}: ${files.length} files, ${todo.length} to copy (${mb(todo.reduce((sum, file) => sum + file.length, 0))})`
      );
      totals.skipped += files.length - todo.length;

      if (DRY_RUN) continue;

      for (const [index, file] of todo.entries()) {
        const id = file._id.toHexString();
        const contentType = file.metadata?.contentType || "application/octet-stream";
        // Generation id for outputs, project id for photos
        const owner = String(file.metadata?.generationId ?? file.metadata?.projectId ?? file.filename ?? id);
        const label = `[${index + 1}/${todo.length}] ${owner} (${mb(file.length)})`;

        try {
          const bytes = await readGridFsFile(bucket, file._id);
          if (bytes.length !== file.length) throw new Error(`read ${bytes.length} of ${file.length} bytes`);
          const hash = sha256(bytes);

          const pathname = `${folder}/${owner.replace(/[^\w.-]+/g, "_")}${EXTENSIONS[contentType] ?? ""}`;
          const blob = await put(pathname, bytes, {
            access: "public",
            // Unguessable link: the app keeps serving files
            // through its own access-checked route
            addRandomSuffix: true,
            contentType,
            multipart: bytes.length > 50 * 1048576,
          });

          // Verify: download the stored copy and compare
          const check = await fetch(blob.url, { cache: "no-store" });
          if (!check.ok) throw new Error(`verify download failed: ${check.status}`);
          const stored = Buffer.from(await check.arrayBuffer());
          if (stored.length !== bytes.length || sha256(stored) !== hash) {
            throw new Error("verify failed: stored copy differs");
          }

          manifest.files[id] = {
            bucket: bucketName,
            gridFsId: id,
            owner,
            contentType,
            size: file.length,
            sha256: hash,
            uploadDate: file.uploadDate.toISOString(),
            blobUrl: blob.url,
            blobPathname: blob.pathname,
            copiedAt: new Date().toISOString(),
          };
          await saveManifest(manifest);

          totals.copied += 1;
          totals.bytes += file.length;
          console.log(`  ✓ ${label}`);
        } catch (error) {
          totals.failed += 1;
          console.error(`  ✗ ${label}: ${error.message}`);
        }
      }
    }
  } finally {
    await client.close();
  }

  console.log(
    DRY_RUN
      ? "Dry run: nothing copied."
      : `Done: ${totals.copied} copied (${mb(totals.bytes)}), ${totals.skipped} already copied, ${totals.failed} failed. Manifest: ${path.relative(ROOT, MANIFEST)}`
  );

  if (totals.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
