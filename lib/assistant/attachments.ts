import type Anthropic from "@anthropic-ai/sdk";
import { del, head } from "@vercel/blob";
import { ChatError } from "@/lib/assistant/store";
import {
  ATTACHMENT_TYPES,
  assistantFolder,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
} from "@/lib/assistant/shared";

// --------------------------------------------------
// ASSISTANT ATTACHMENTS
//
// Files the browser uploaded (app/api/assistant/upload)
// become content blocks Claude reads by URL: images it
// sees, PDFs it reads. Only files in the sender's own
// folder, of an allowed kind and size, are accepted; the
// details come from storage, never from the browser.
// --------------------------------------------------

const fileName = (pathname: string) =>
  (pathname.split("/").pop() ?? "file").replace(/-[A-Za-z0-9]{20,}(?=\.[^.]+$)/, "");

export async function attachmentBlocks(
  userId: string,
  raw: unknown,
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    throw new ChatError(400, "Attachments must be a list of uploaded files");
  }
  if (raw.length > MAX_ATTACHMENTS) throw new ChatError(400, `Attach at most ${MAX_ATTACHMENTS} files`);

  const folder = assistantFolder(userId);
  return Promise.all(
    [...new Set(raw as string[])].map(async (url) => {
      let blob: Awaited<ReturnType<typeof head>>;
      try {
        blob = await head(url);
      } catch {
        throw new ChatError(400, "An attached file wasn't found. Attach it again.");
      }
      if (!blob.pathname.startsWith(folder) || blob.pathname.includes("..")) {
        throw new ChatError(403, "That file isn't one of your uploads");
      }
      if (!ATTACHMENT_TYPES.includes(blob.contentType)) {
        throw new ChatError(415, "Only images (PNG, JPEG, WebP, GIF) and PDFs can be attached");
      }

      const name = fileName(blob.pathname);
      if (blob.contentType === "application/pdf") {
        if (blob.size > MAX_PDF_BYTES) throw new ChatError(413, `${name} is larger than 30 MB`);
        return { type: "document", source: { type: "url", url: blob.url }, title: name } satisfies Anthropic.Beta.BetaRequestDocumentBlock;
      }
      if (blob.size > MAX_IMAGE_BYTES) throw new ChatError(413, `${name} is larger than 5 MB`);
      return { type: "image", source: { type: "url", url: blob.url } } satisfies Anthropic.Beta.BetaImageBlockParam;
    }),
  );
}

// Removes a deleted chat's uploads (only ones in the
// assistant folder; best effort)
export async function deleteAttachments(urls: string[]): Promise<void> {
  const ours = urls.filter((url) => {
    try {
      // Every one was checked when it was sent; this only
      // keeps a stray URL outside the folder from going
      return /(^|\/)assistant\//.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
  if (!ours.length) return;
  try {
    await del(ours);
  } catch (error) {
    console.error("Delete assistant attachments failed:", error instanceof Error ? error.message : error);
  }
}
