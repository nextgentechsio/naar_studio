// --------------------------------------------------
// CROP AN IMAGE TO AN ASPECT RATIO (in the browser)
//
// For models that take their shape from the image
// (lib/higgsfield/models.ts, cropsToAspectRatio): the
// middle of the image, as large as fits the ratio, at
// full resolution. Nothing is scaled or stretched.
// --------------------------------------------------

// Close enough to count as the same shape
const RATIO_TOLERANCE = 0.01;
const JPEG_QUALITY = 0.95;

// 16 / 9 for "16:9"; null for anything else (e.g.
// "match_input_image")
export function parseRatio(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export type CropArea = { x: number; y: number; width: number; height: number };

// The centred area of a width × height image (or video)
// with the given ratio; null when it already has that shape
export function cropArea(width: number, height: number, ratio: number): CropArea | null {
  if (Math.abs(width / height / ratio - 1) < RATIO_TOLERANCE) return null;

  if (width / height > ratio) {
    const cropped = Math.round(height * ratio);
    return { x: Math.round((width - cropped) / 2), y: 0, width: cropped, height };
  }

  const cropped = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - cropped) / 2), width, height: cropped };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't crop the image."))),
      type,
      JPEG_QUALITY
    )
  );
}

// An image in the form, cropped to `label` (e.g. "16:9")
// and uploaded. Null when it already has that shape.
export async function cropImageAt(
  url: string,
  label: string,
  upload: (file: File) => Promise<string>,
  onStatus: (status: string) => void
): Promise<{ url: string; note: string } | null> {
  const ratio = parseRatio(label);
  if (!ratio) return null;

  onStatus(`Cropping image to ${label}…`);
  let bitmap: ImageBitmap;
  let type: string;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    type = blob.type;
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(
      `Couldn't fetch the image to crop it to ${label}. Upload it again from this page, or choose "Match input image".`
    );
  }

  try {
    const area = cropArea(bitmap.width, bitmap.height, ratio);
    if (!area) return null;

    const canvas = document.createElement("canvas");
    canvas.width = area.width;
    canvas.height = area.height;
    canvas
      .getContext("2d")!
      .drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

    // PNGs (e.g. with transparency) stay PNG
    const png = type === "image/png";
    const cropped = await canvasBlob(canvas, png ? "image/png" : "image/jpeg");
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image").replace(/\.[^.]+$/, "");
    const file = new File([cropped], `${base}-${label.replace(":", "x")}.${png ? "png" : "jpg"}`, {
      type: cropped.type,
    });

    onStatus("Uploading cropped image…");
    return {
      url: await upload(file),
      note: `Cropped from ${bitmap.width}×${bitmap.height} to ${area.width}×${area.height} (${label})`,
    };
  } finally {
    bitmap.close();
  }
}
