import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, Maximize2, ExternalLink } from "lucide-react";
import { ChevronRight } from "@icons/chevron-right";
import { ChevronLeft } from "@icons/chevron-left";
import { cn } from "@src/lib/utils";
import { getExternalEmbedSandbox } from "@src/utils/media-embed";
import {
  MorphingDialogContainer,
  MorphingDialogContent,
  useMorphingDialog,
} from "@components/ui/morphing-dialog";
import type { MediaOcrMetadata } from "@src/schemas/item_schema";
import { OcrExtractedText } from "@components/TabGroups/OcrExtractedText";

export type LightboxEntry = {
  type: "image" | "video" | "audio";
  src: string;
  embedType?: "iframe";
  thumbnailSrc?: string;
  width?: number;
  height?: number;
  altText?: string;
  isGif?: boolean;
  isVertical?: boolean;
  ocr?: MediaOcrMetadata;
};

export type LightboxMetadata = {
  title?: string;
  hostname?: string;
  url?: string;
  iconUrl?: string;
  source?: string;
  date?: string;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.4;

// Apple-ish ease for the post-morph chrome fade.
const CHROME_ENTER_DELAY = 160;

export const MediaLightboxModal = ({
  entries,
  initialIndex = 0,
  metadata,
  onClose,
}: {
  entries: LightboxEntry[];
  initialIndex?: number;
  metadata?: LightboxMetadata;
  onClose?: () => void;
}) => {
  const { isOpen, closeDialog } = useMorphingDialog();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(initialIndex);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      onClose?.();
    }
  }, [isOpen, initialIndex, onClose]);

  const hasMultiple = entries.length > 1;
  const current = entries[activeIndex];

  const goTo = useCallback(
    (index: number) => {
      if (entries.length === 0) return;
      const clamped = ((index % entries.length) + entries.length) % entries.length;
      setActiveIndex(clamped);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    },
    [entries.length]
  );

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const next = Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);
  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDialog();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, next, prev, zoomIn, zoomOut, resetZoom, closeDialog]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!current || current.type !== "image") return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    setPan({
      x: dragStart.current.px + (e.clientX - dragStart.current.x),
      y: dragStart.current.py + (e.clientY - dragStart.current.y),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStart.current) {
      dragStart.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  };

  if (entries.length === 0) return null;

  // Chrome (close/zoom/nav/metadata) fades in shortly after the morph settles.
  const chromeClass = cn(
    "animate-in fade-in-0 duration-200 ease-out",
    `[animation-delay:${CHROME_ENTER_DELAY}ms]`
  );

  return (
    <MorphingDialogContainer
      className={cn(
        "w-screen h-screen max-w-none max-h-none m-0 p-0",
        "backdrop:bg-foreground-darkest/90 backdrop:backdrop-blur-md"
      )}
    >
    <MorphingDialogContent
      className={cn(
        "w-full h-full max-w-none max-h-none m-0 p-0 rounded-none bg-transparent shadow-none",
        "flex items-center justify-center",
        "select-none group/lightbox"
      )}
    >
      {/* Close — top-right */}
      <button
        type="button"
        onClick={closeDialog}
        aria-label="Close"
        className={cn(
          "fixed top-5 right-5 z-20 w-10 h-10 rounded-full",
          "flex items-center justify-center",
          "bg-background-neutral/70 backdrop-blur-md",
          "border border-border-neutral-faded/60",
          "text-foreground-secondary hover:text-foreground-primary",
          "shadow-lg transition-all duration-200",
          "hover:bg-background-neutral active:scale-[0.94] cursor-pointer",
          chromeClass
        )}
      >
        <X size={18} />
      </button>

      {/* Counter — top-center */}
      {hasMultiple && (
        <div
          className={cn(
            "fixed top-5 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-background-neutral/70 backdrop-blur-md border border-border-neutral-faded/60 text-xs text-foreground-secondary tabular-nums shadow-md",
            chromeClass
          )}
        >
          {activeIndex + 1} / {entries.length}
        </div>
      )}

      {/* Zoom controls — bottom-center, images only */}
      {current?.type === "image" && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2 py-1.5 rounded-full bg-background-neutral/70 backdrop-blur-md border border-border-neutral-faded/60 shadow-md",
            chromeClass
          )}
        >
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              "text-foreground-secondary hover:text-foreground-primary hover:bg-background-highlight",
              "transition-colors duration-200 cursor-pointer",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-[11px] text-foreground-secondary tabular-nums min-w-[3.5rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              "text-foreground-secondary hover:text-foreground-primary hover:bg-background-highlight",
              "transition-colors duration-200 cursor-pointer",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <ZoomIn size={16} />
          </button>
          <div className="w-px h-5 bg-border-neutral-faded mx-0.5" />
          <button
            type="button"
            onClick={resetZoom}
            aria-label="Reset zoom"
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              "text-foreground-secondary hover:text-foreground-primary hover:bg-background-highlight",
              "transition-colors duration-200 cursor-pointer"
            )}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      )}

      {/* Metadata — bottom-right */}
      {metadata && (metadata.title || metadata.hostname || metadata.source) && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-20 max-w-[320px]",
            "px-4 py-3 rounded-xl",
            "bg-background-neutral/80 backdrop-blur-md",
            "border border-border-neutral-faded/60 shadow-lg",
            "transition-opacity duration-300",
            zoom > 1 ? "opacity-30 hover:opacity-100" : "opacity-100",
            chromeClass
          )}
        >
          {metadata.iconUrl && metadata.hostname && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <img
                src={metadata.iconUrl}
                alt=""
                className="w-4 h-4 rounded-sm object-contain flex-shrink-0"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <span className="text-[11px] text-foreground-tertiary">{metadata.hostname}</span>
            </div>
          )}
          {metadata.title && (
            <p className="text-sm font-medium text-foreground-primary line-clamp-2 leading-snug">
              {metadata.title}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {metadata.source && (
              <span className="text-[10px] uppercase tracking-[0.08em] text-foreground-tertiary font-medium">
                {metadata.source}
              </span>
            )}
            {metadata.date && (
              <span className="text-[10px] text-foreground-tertiary tabular-nums">
                {metadata.date}
              </span>
            )}
          </div>
          {metadata.url && (
            <a
              href={metadata.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "mt-2 flex items-center gap-1.5 text-[11px]",
                "text-foreground-secondary hover:text-foreground-primary",
                "transition-colors duration-200"
              )}
            >
              <ExternalLink size={11} />
              <span className="truncate">{metadata.hostname || metadata.url}</span>
            </a>
          )}
        </div>
      )}

      {/* Extracted OCR text — bottom-left, images only */}
      {current?.type === "image" && current.ocr && (
        <OcrExtractedText
          ocr={current.ocr}
          variant="overlay"
          className={cn(
            "fixed bottom-6 left-6 z-20 max-w-[min(360px,42vw)]",
            zoom > 1 ? "opacity-30 transition-opacity duration-300 hover:opacity-100" : "",
            chromeClass
          )}
        />
      )}

      {/* Prev / Next — visible on hover */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous"
            className={cn(
              "fixed left-5 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full",
              "flex items-center justify-center",
              "bg-background-neutral/70 backdrop-blur-md",
              "border border-border-neutral-faded/60",
              "text-foreground-secondary hover:text-foreground-primary",
              "shadow-lg transition-all duration-300",
              "hover:bg-background-neutral active:scale-[0.92] cursor-pointer",
              "opacity-0 group-hover/lightbox:opacity-100",
              chromeClass
            )}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next"
            className={cn(
              "fixed right-5 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full",
              "flex items-center justify-center",
              "bg-background-neutral/70 backdrop-blur-md",
              "border border-border-neutral-faded/60",
              "text-foreground-secondary hover:text-foreground-primary",
              "shadow-lg transition-all duration-300",
              "hover:bg-background-neutral active:scale-[0.92] cursor-pointer",
              "opacity-0 group-hover/lightbox:opacity-100",
              chromeClass
            )}
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {/* Media stage — centered, fit display.
          Clicking the empty letterbox area (the stage itself, not its media
          children) dismisses the modal. Media elements stop propagation so
          interacting with video controls / iframe / image zoom never closes. */}
      <div
        className={cn(
          "w-full h-full flex items-center justify-center overflow-hidden",
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        )}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => (zoom === 1 ? zoomIn() : resetZoom())}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
      >
        {!current ? (
          <div className="text-foreground-tertiary text-sm">No media available</div>
        ) : current.type === "video" ? (
          current.embedType === "iframe" ? (
            <iframe
              src={current.src}
              title={current.altText || metadata?.title || "Embedded media preview"}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox={getExternalEmbedSandbox(current.src, { allowPresentation: true, allowPopups: true })}
              className="max-h-[88vh] max-w-[88vw] rounded-md bg-background-page-secondary shadow-2xl"
              style={{
                aspectRatio:
                  current.width && current.height
                    ? `${current.width} / ${current.height}`
                    : current.isVertical
                      ? "9 / 16"
                      : "16 / 9",
                width:
                  (current.width && current.height && current.height > current.width) || current.isVertical
                    ? "min(48vw, 520px)"
                    : "88vw",
              }}
              key={current.src}
            />
          ) : (
            <video
              controls
              autoPlay
              playsInline
              className="max-h-[88vh] max-w-[88vw] object-contain rounded-md shadow-2xl"
              key={current.src}
            >
              <source src={current.src} />
            </video>
          )
        ) : (
          <img
            src={current.src}
            alt={current.altText || `Media ${activeIndex + 1}`}
            className="max-h-[88vh] max-w-[88vw] object-contain rounded-md shadow-2xl"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragStart.current ? "none" : "transform 200ms cubic-bezier(0.22,1,0.36,1)",
              willChange: "transform",
            }}
            draggable={false}
            key={current.src}
          />
        )}
      </div>
    </MorphingDialogContent>
    </MorphingDialogContainer>
  );
};

export default MediaLightboxModal;
