"use client";

import type { CSSProperties } from "react";
import type { Crop } from "@/lib/catalogue/shared";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// AN IMAGE SHOWN THROUGH ITS CROP
//
// Fills its (positioned) parent the way object-cover
// would, but only with the cropped part. Works from the
// image's own aspect (`imageRatio`, width / height) and
// the box's (`boxRatio`); without a crop it's a plain
// cover image.
// --------------------------------------------------

export function croppedRatio(imageRatio: number, crop: Crop | null) {
  return crop ? (imageRatio * crop.w) / crop.h : imageRatio;
}

export function cropStyle(imageRatio: number, crop: Crop, boxRatio: number): CSSProperties {
  const cropRatio = croppedRatio(imageRatio, crop);
  let width: number;
  let height: number;
  let left: number;
  let top: number;
  if (cropRatio >= boxRatio) {
    // The crop's height fills the box; centred across
    height = 100 / crop.h;
    width = (height * imageRatio) / boxRatio;
    top = -crop.y * height;
    left = -crop.x * width + (100 - crop.w * width) / 2;
  } else {
    // Its width fills the box; centred down
    width = 100 / crop.w;
    height = (width * boxRatio) / imageRatio;
    left = -crop.x * width;
    top = -crop.y * height + (100 - crop.h * height) / 2;
  }
  return {
    position: "absolute",
    width: `${width}%`,
    height: `${height}%`,
    left: `${left}%`,
    top: `${top}%`,
    maxWidth: "none",
  };
}

export default function CroppedImage({
  src,
  crop,
  imageRatio,
  boxRatio,
  alt,
  className,
  onRatio,
  loading,
}: {
  src: string;
  crop: Crop | null;
  // Width / height of the image (3:4 until it loads)
  imageRatio: number;
  boxRatio: number;
  alt: string;
  className?: string;
  // The real width / height, once it's loaded
  onRatio?: (ratio: number) => void;
  loading?: "lazy" | "eager";
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={loading}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight) onRatio?.(naturalWidth / naturalHeight);
      }}
      style={crop ? cropStyle(imageRatio, crop, boxRatio) : undefined}
      className={cx(crop ? "" : "absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
