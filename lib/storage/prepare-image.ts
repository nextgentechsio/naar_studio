// --------------------------------------------------
// CLIENT-SIDE PHOTO PREPARATION (browser only)
//
// Downscales large photos and re-encodes them as WebP
// before upload: smaller uploads, and re-encoding drops
// EXIF metadata such as GPS location. GIFs are sent
// as-is to keep animation. If the browser can't decode
// the file, the original is sent and the server
// decides (it validates every upload anyway).
// --------------------------------------------------

const MAX_EDGE_PX = 1600;
const WEBP_QUALITY = 0.86;

export async function prepareProjectPhoto(
  file: File
): Promise<Blob> {
  if (file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });

    const scale = Math.min(
      1,
      MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height)
    );

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, WEBP_QUALITY)
      );

    // Browsers without a WebP encoder silently return
    // PNG, which is huge for photos; use JPEG instead
    let blob = await encode("image/webp");

    if (blob?.type !== "image/webp") {
      blob = await encode("image/jpeg");
    }

    return blob ?? file;
  } catch {
    return file;
  }
}
