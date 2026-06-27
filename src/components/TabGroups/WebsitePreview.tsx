import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@components/ui/sheet";
import { Button } from "@components/ui/button";
import { OpenArrowIcon } from "@icons/open-arrow";
import { MediaCarousel } from "@components/TabGroups/MediaCarousel";
import { useState, useEffect, useRef } from "react";
import { cn } from "@src/lib/utils";
import { Loader2 } from "lucide-react";
import type { ItemDocType } from "@src/schemas/item_schema";
import { getExternalEmbedSandbox } from "@src/utils/media-embed";

interface WebsitePreviewProps {
  url: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ItemDocType;
}

export const WebsitePreview = ({ url, title, open, onOpenChange, item }: WebsitePreviewProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadGuardRef = useRef<number | null>(null);

  // Reset state when url changes or re-opens
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setLoadError(false);
    }
  }, [open, url]);

  // Fallback for sites that refuse to be iframed (X-Frame-Options / CSP).
  useEffect(() => {
    if (!open || !isLoading) {
      if (loadGuardRef.current) {
        clearTimeout(loadGuardRef.current);
        loadGuardRef.current = null;
      }
      return;
    }

    loadGuardRef.current = window.setTimeout(() => {
      setLoadError(true);
      setIsLoading(false);
    }, 5000);

    return () => {
      if (loadGuardRef.current) {
        clearTimeout(loadGuardRef.current);
        loadGuardRef.current = null;
      }
    };
  }, [open, isLoading, url]);

  const handleOpenInNewTab = () => {
    window.open(url, "_blank");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-4xl p-0 flex flex-col gap-0 border-l border-border-neutral-faded"
      >
        <SheetHeader className="px-4 py-3 border-b border-border-neutral-faded flex flex-row items-center justify-between space-y-0 bg-background-neutral">
          <div className="flex flex-col gap-0.5 overflow-hidden text-left">
            <SheetTitle className="text-base truncate">{title}</SheetTitle>
            <SheetDescription className="truncate text-xs">{url}</SheetDescription>
          </div>
          <div className="flex items-center gap-2 pl-4">
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={handleOpenInNewTab}>
              <OpenArrowIcon size={14} />
              <span className="hidden sm:inline">Open in New Tab</span>
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 relative bg-background-page">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background-neutral z-10">
              <Loader2 className="h-8 w-8 animate-spin text-accent-primary mb-4" />
              <p className="text-sm text-foreground-secondary">Loading preview...</p>
            </div>
          )}

          {/* A preview is a full browser renderer.  Do not create it until the
              sheet is actually open: this component is rendered once per row. */}
          {open && (
            <iframe
              src={url}
              className={cn("w-full h-full border-none", isLoading ? "opacity-0" : "opacity-100")}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setLoadError(true);
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              sandbox={getExternalEmbedSandbox(url, { allowForms: true, allowPopups: true })}
            />
          )}

          {loadError && (
            <div className="absolute inset-0 flex flex-col z-20 bg-background-neutral">
              {item && (item.media || []).length > 0 ? (
                <>
                  <div className="flex-1 min-h-0">
                    <MediaCarousel
                      media={item.media}
                      displayImageUrl={item.displayImageUrl}
                      pageUrl={item.url}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-2 px-6 py-3 border-t border-border-neutral-faded bg-background-neutral text-center">
                    <p className="text-xs text-foreground-tertiary flex-1">
                      Preview blocked — showing saved media instead.
                    </p>
                    <Button variant="outline" size="sm" onClick={handleOpenInNewTab} className="h-7 gap-1.5 text-xs">
                      <OpenArrowIcon size={12} />
                      Open original
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-foreground-secondary">
                    Preview blocked. Many sites refuse to load inside iframes (X-Frame-Options / CSP).
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
                      Open in New Tab
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setLoadError(false);
                        setIsLoading(true);
                      }}
                    >
                      Try again
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 
            Since we can't reliably detect X-Frame-Options blocks via onError,
            we show a help message if it takes too long or if the user sees a gray screen.
            Actually, the iframe will just be empty or show a sad face.
            We can overlay a button if it's taking too long? 
            Or just rely on the top bar button. 
          */}
        </div>
      </SheetContent>
    </Sheet>
  );
};
