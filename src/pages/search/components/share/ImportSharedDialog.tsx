import { useEffect, useState } from "react";
import { Download, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@src/components/ui/dialog";
import { Button } from "@src/components/ui/button";
import { Input } from "@src/components/ui/input";
import { importSharedLink, isShareApiError } from "@src/services/share.service";
import { importSharedSnapshot } from "@src/services/share-snapshot";
import {
  resolveToastErrorMessage,
  showErrorToast,
  showLoadingToast,
  showSuccessToast,
} from "@src/utils/toast-feedback";

type ImportSharedDialogState =
  | { kind: "form" }
  | { kind: "importing" }
  | { kind: "error"; message: string };

interface ImportSharedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAfterImport?: () => void;
}

const describeImportError = (error: unknown): string => {
  if (isShareApiError(error)) {
    switch (error.code) {
      case "PIN_REQUIRED":
        return "This link is PIN-protected. Enter the PIN to import it.";
      case "PIN_INVALID":
        return "That PIN is incorrect.";
      case "SHARE_REVOKED":
        return "This share has been revoked by its owner.";
      case "SHARE_NOT_FOUND":
        return "We couldn't find a share at that link. Double-check it and try again.";
      default:
        return error.message || `Import failed (${error.code}).`;
    }
  }
  return resolveToastErrorMessage(error, "Could not import this link.");
};

export const ImportSharedDialog = ({
  open,
  onOpenChange,
  onAfterImport,
}: ImportSharedDialogProps) => {
  const [url, setUrl] = useState("");
  const [pin, setPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [state, setState] = useState<ImportSharedDialogState>({ kind: "form" });

  useEffect(() => {
    if (open) {
      setUrl("");
      setPin("");
      setPinVisible(false);
      setPinRequired(false);
      setPinError(null);
      setState({ kind: "form" });
    }
  }, [open]);

  const trimmedUrl = url.trim();
  const canImport = trimmedUrl.length > 0 && state.kind !== "importing";

  const handleImport = async () => {
    if (!trimmedUrl) return;
    const trimmedPin = pin.trim();
    setPinError(null);
    setState({ kind: "importing" });
    const toastId = showLoadingToast("Fetching shared link…");
    try {
      const snapshot = await importSharedLink(trimmedUrl, trimmedPin || undefined);
      const result = await importSharedSnapshot({
        snapshot,
        rootFolderName: snapshot.title,
      });
      const tabs = result.itemCount;
      const groups = result.folderCount;
      showSuccessToast(
        `Imported ${tabs} tab${tabs === 1 ? "" : "s"} and ${groups} tab group${groups === 1 ? "" : "s"}.`,
        { id: toastId }
      );
      onAfterImport?.();
      onOpenChange(false);
    } catch (error) {
      const message = describeImportError(error);
      if (isShareApiError(error, "PIN_REQUIRED")) {
        setPinVisible(true);
        setPinRequired(true);
        setPinError(null);
        setState({ kind: "form" });
        showErrorToast(message, { id: toastId });
        return;
      }
      if (isShareApiError(error, "PIN_INVALID")) {
        setPinVisible(true);
        setPinError("That PIN is incorrect.");
        setState({ kind: "form" });
        showErrorToast(message, { id: toastId });
        return;
      }
      setState({ kind: "error", message });
      showErrorToast(message, { id: toastId });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (state.kind === "importing") return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download size={18} className="text-accent" />
            Import shared link
          </DialogTitle>
          <DialogDescription>
            Paste a Vibesearch share link to copy its tabs into a new tab group on this device.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "error" ? (
          <div className="space-y-2 py-1 text-sm">
            <div className="flex items-start gap-2 rounded-lg border border-border-danger-faded bg-background-danger-faded/60 px-3 py-2 text-foreground-danger">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <span className="break-words">{state.message}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setState({ kind: "form" })}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/s/pub_….sec_…"
              autoFocus
              disabled={state.kind === "importing"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canImport) {
                  void handleImport();
                }
              }}
            />

            {!pinVisible ? (
              <button
                type="button"
                onClick={() => setPinVisible(true)}
                className="inline-flex items-center gap-1.5 px-1 text-xs font-medium text-foreground-secondary hover:text-foreground-neutral"
              >
                <KeyRound size={12} />
                This link has a PIN
              </button>
            ) : (
              <div className="space-y-1.5">
                <Input
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setPinError(null);
                  }}
                  placeholder="PIN"
                  autoFocus
                  inputMode="text"
                  autoComplete="off"
                  maxLength={32}
                  aria-invalid={!!pinError}
                  disabled={state.kind === "importing"}
                  className="font-mono tracking-[0.25em]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canImport) {
                      void handleImport();
                    }
                  }}
                />
                {pinError ? (
                  <p className="px-1 text-xs text-foreground-danger">{pinError}</p>
                ) : pinRequired ? (
                  <p className="px-1 text-xs text-foreground-tertiary">
                    This link is PIN-protected. Enter the PIN to import it.
                  </p>
                ) : (
                  <p className="px-1 text-xs text-foreground-tertiary">
                    Leave blank if the link isn&apos;t protected.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {state.kind === "importing" && (
          <div className="flex items-center justify-center gap-2 py-1 text-sm text-foreground-secondary">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            Importing snapshot…
          </div>
        )}

        {state.kind !== "error" && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={state.kind === "importing"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleImport()}
              disabled={!canImport}
              static={state.kind === "importing"}
            >
              {state.kind === "importing" ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ImportSharedDialog;
