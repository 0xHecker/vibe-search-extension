import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@src/lib/utils";
import { ItemDocType } from "@src/schemas/item_schema";

type ResolvedMedia = {
  type: "image" | "video" | "audio";
  src: string;
  totalCount: number;
};

const resolveMedia = (item: ItemDocType): ResolvedMedia | null => {
  const mediaEntries = (item.media || []).filter(
    (entry) => typeof entry?.s3Url === "string" || typeof entry?.originalUrl === "string"
  );
  const totalCount = mediaEntries.length > 0 ? mediaEntries.length : item.displayImageUrl ? 1 : 0;

  if (item.displayImageUrl) {
    return { type: "image", src: item.displayImageUrl, totalCount: Math.max(1, totalCount) };
  }

  const candidate = mediaEntries[0];
  if (!candidate) return null;

  const src = candidate.s3Url || candidate.originalUrl;
  if (!src) return null;

  if (candidate.type === "video") return { type: "video", src, totalCount };
  if (candidate.type === "audio") return { type: "audio", src, totalCount };
  return { type: "image", src, totalCount };
};

export const ItemMediaPreview = ({
  item,
  className,
}: {
  item: ItemDocType;
  className?: string;
}) => {
  const media = useMemo(() => resolveMedia(item), [item]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isErrored, setIsErrored] = useState(false);

  useEffect(() => {
    if (!media || isVisible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin: "320px 0px", threshold: 0.01 }
    );
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [isVisible, media]);

  if (!media) return null;
  const extraCount = Math.max(0, media.totalCount - 1);

  const fallback = (
    <div className="rounded-sm-semi border border-border-neutral-faded bg-background-page-secondary px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-foreground-tertiary">
      {media.type}
    </div>
  );

  return (
    <div ref={hostRef} className={cn("w-full", className)}>
      {!isVisible || isErrored ? (
        fallback
      ) : media.type === "image" ? (
        <div className="relative">
          <img
            src={media.src}
            alt={item.title || "Imported media"}
            loading="lazy"
            decoding="async"
            className="w-full object-cover rounded-sm-semi"
            onError={() => {
              setIsErrored(true);
            }}
          />
          {extraCount > 0 && (
            <span className="absolute right-2 bottom-2 rounded-full bg-background-neutral/90 px-2 py-0.5 text-[10px] font-medium text-foreground-secondary">
              +{extraCount}
            </span>
          )}
        </div>
      ) : media.type === "video" ? (
        <div className="relative">
          <video
            controls
            preload="none"
            playsInline
            className="w-full rounded-sm-semi border border-border-neutral-faded bg-background-page-secondary"
            onError={() => {
              setIsErrored(true);
            }}
          >
            <source src={media.src} />
          </video>
          {extraCount > 0 && (
            <span className="absolute right-2 bottom-2 rounded-full bg-background-neutral/90 px-2 py-0.5 text-[10px] font-medium text-foreground-secondary">
              +{extraCount}
            </span>
          )}
        </div>
      ) : (
        <div className="rounded-sm-semi border border-border-neutral-faded bg-background-page-secondary px-2 py-2">
          <audio
            controls
            preload="none"
            className="w-full"
            onError={() => {
              setIsErrored(true);
            }}
          >
            <source src={media.src} />
          </audio>
          {extraCount > 0 && (
            <div className="mt-1 text-[10px] font-medium text-foreground-secondary">+{extraCount} more media</div>
          )}
        </div>
      )}
    </div>
  );
};
