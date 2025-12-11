import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@components/ui/sheet";
import { Button } from "@components/ui/button";
import { OpenArrowIcon } from "@components/icons/open-arrow";
import { useState, useEffect, useRef } from "react";
import { cn } from "@src/lib/utils";
import { Loader2 } from "lucide-react";

interface WebsitePreviewProps {
  url: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WebsitePreview = ({ url, title, open, onOpenChange }: WebsitePreviewProps) => {
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
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />

          {loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-neutral z-20 px-6 text-center">
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
