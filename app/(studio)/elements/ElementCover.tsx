import type { Element } from "@/lib/element-mentions";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// AN ELEMENT'S COVER (lists, chips, cards)
//
// Its first image; with no images, the first frame of its
// first video; with neither, a voice icon. Size and shape
// come from className.
// --------------------------------------------------

export default function ElementCover({
  element,
  className,
  iconSize = 16,
}: {
  element: Pick<Element, "images" | "videos">;
  className?: string;
  iconSize?: number;
}) {
  const [image] = element.images;
  const [video] = element.videos;

  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" loading="lazy" className={cx("bg-black object-cover", className)} />;
  }

  if (video) {
    return <video src={`${video}#t=0.1`} muted playsInline preload="metadata" aria-hidden className={cx("bg-black object-cover", className)} />;
  }

  return (
    <span aria-hidden className={cx("flex items-center justify-center bg-accent-soft text-accent", className)}>
      <Icon name="audio" size={iconSize} />
    </span>
  );
}
