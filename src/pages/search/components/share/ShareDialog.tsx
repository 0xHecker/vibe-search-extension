import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Layers, Loader2, Share2, ShieldAlert, X } from "lucide-react";
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
import { SettingSwitch } from "@src/pages/search/components/settings/SettingsPrimitives";
import { cn } from "@src/lib/utils";
import {
  ShareApiError,
  createShare,
  describeShareSelection,
  rememberShareLink,
  type MixedShareSelection,
} from "@src/services/share.service";
import { buildShareSnapshotFromMixed } from "@src/services/share-snapshot";
import {
  resolveToastErrorMessage,
  showErrorToast,
  showLoadingToast,
  showSuccessToast,
} from "@src/utils/toast-feedback";

export type ShareDialogSelection = MixedShareSelection;

const PIN_REGEX = /^[A-Za-z0-9]{4,32}$/;

type ShareDialogState =
  | { kind: "form" }
  | { kind: "creating" }
  | { kind: "result"; publicUrl: string; shareId: string; indexed: boolean; pinProtected: boolean }
  | { kind: "error"; message: string };

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: ShareDialogSelection;
  defaultTitle?: string;
  onAfterShare?: () => void;
}

export const ShareDialog = ({
  open,
  onOpenChange,
  selection,
  defaultTitle = "",
  onAfterShare,
}: ShareDialogProps) => {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [allowIndexing, setAllowIndexing] = useState(false);
  const [requirePin, setRequirePin] = useState(false);
  const [pin, setPin] = useState("");
  const [state, setState] = useState<ShareDialogState>({ kind: "form" });

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setDescription("");
      setAllowIndexing(false);
      setRequirePin(false);
      setPin("");
      setState({ kind: "form" });
    }
  }, [open, defaultTitle]);

  const selectionSummary = useMemo(() => describeShareSelection(selection), [selection]);

  const trimmedPin = pin.trim();
  const pinIsValid = PIN_REGEX.test(trimmedPin);
  const showPinError = requirePin && trimmedPin.length > 0 && !pinIsValid;
  const canCreate = selectionSummary.count > 0 && (!requirePin || pinIsValid);

  const handleCreate = async () => {
    if (requirePin && !pinIsValid) return;
    const trimmedTitle = title.trim() || defaultTitle || "Shared snapshot";
    const usePin = requirePin && pinIsValid;
    setState({ kind: "creating" });
    const toastId = showLoadingToast("Building share snapshot…");
    try {
      const snapshot = await buildShareSnapshotFromMixed({
        selection: {
          folderIds: selection.folderIds,
          itemIds: selection.itemIds,
          spaceIds: selection.spaceIds,
          spaceGroupIds: selection.spaceGroupIds,
        },
        title: trimmedTitle,
        description: description.trim() || undefined,
      });

      const sourceIds = snapshot.source.ids;
      const response = await createShare({
        title: trimmedTitle,
        description: description.trim() || undefined,
        sourceKind: snapshot.source.kind,
        sourceIds,
        snapshot,
        pin: usePin ? trimmedPin : undefined,
      });

      // The worker can't rebuild this link later (it stores only a hash of the
      // secret), so keep the real capability URL locally for the manage panel.
      void rememberShareLink(response.shareId, response.publicUrl);

      if (allowIndexing) {
        try {
          await fetch(response.publicUrl, { method: "GET", mode: "no-cors" });
        } catch {}
      }

      setState({
        kind: "result",
        publicUrl: response.publicUrl,
        shareId: response.shareId,
        indexed: allowIndexing,
        pinProtected: response.requiresPin ?? usePin,
      });
      showSuccessToast("Share link ready.", { id: toastId });
      onAfterShare?.();
    } catch (error) {
      const message =
        error instanceof ShareApiError
          ? `${error.code}: ${error.message || "Worker rejected the snapshot."}`
          : resolveToastErrorMessage(error, "Failed to create share.");
      setState({ kind: "error", message });
      showErrorToast(message, { id: toastId });
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showSuccessToast("Link copied.", { tempo: "quick" });
    } catch {
      showErrorToast("Could not copy link.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (state.kind === "creating") return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 size={18} className="text-accent" />
            Share selection
          </DialogTitle>
          <DialogDescription>
            Creates a permanent, revokable link with a snapshot of the selected tabs.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "form" && (
          <div className="py-1">
            {/* What's being packaged — context, not a control. */}
            <div className="flex items-center gap-2 text-xs font-medium text-foreground-secondary">
              <Layers size={13} className="shrink-0 text-foreground-icon" />
              <span className="truncate">{selectionSummary.label}</span>
            </div>

            {/* Title + description */}
            <div className="mt-3 space-y-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate) {
                    void handleCreate();
                  }
                }}
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
              />
            </div>

            {/* Options */}
            <div className="mt-4 border-t border-border-neutral-faded">
              <div className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground-neutral">
                    Allow search-engine indexing
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                    Lets crawlers discover this link. Revoking stops future crawls but can&apos;t
                    delete cached copies.
                  </p>
                </div>
                <SettingSwitch
                  checked={allowIndexing}
                  onCheckedChange={setAllowIndexing}
                  label="Allow search-engine indexing"
                />
              </div>

              <div className="border-t border-border-neutral-faded/70 pt-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground-neutral">Require a PIN</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                      Viewers must enter this PIN to open or import the link.
                    </p>
                  </div>
                  <SettingSwitch
                    checked={requirePin}
                    onCheckedChange={setRequirePin}
                    label="Require a PIN"
                  />
                </div>
                {requirePin && (
                  <div className="mt-3 space-y-1.5">
                    <Input
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="4–32 letters or digits"
                      autoFocus
                      inputMode="text"
                      autoComplete="off"
                      maxLength={32}
                      aria-invalid={showPinError}
                      className="font-mono tracking-[0.25em]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canCreate) {
                          void handleCreate();
                        }
                      }}
                    />
                    {showPinError && (
                      <p className="px-0.5 text-xs text-foreground-danger">
                        Use 4–32 letters or digits, no spaces or symbols.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {state.kind === "creating" && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-accent mb-3" />
            <p className="text-sm text-foreground-secondary">
              Building snapshot and registering share…
            </p>
          </div>
        )}

        {state.kind === "result" && (
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground-positive">
              <Check size={16} />
              Share created
            </div>
            {state.indexed && (
              <p className="text-xs text-foreground-secondary">
                Indexing allowed — search engines may pick this link up over the next few days.
              </p>
            )}
            {state.pinProtected && (
              <p className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                <KeyRound size={12} className="shrink-0 text-accent" />
                PIN-protected — share the PIN separately so viewers can open it.
              </p>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-border-neutral-faded bg-background-neutral-faded/60 px-2 py-1.5">
              <input
                readOnly
                value={state.publicUrl}
                className="flex-1 bg-transparent px-1 text-xs text-foreground-neutral outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => void handleCopyLink(state.publicUrl)}
              >
                <Copy size={14} />
              </Button>
              <a
                href={state.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="grid size-7 place-items-center rounded-md text-foreground-secondary hover:bg-background-neutral-faded hover:text-foreground-neutral"
                title="Open share"
              >
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="text-xs text-foreground-secondary">
              Revoke from the Manage Shares panel to take it down instantly.
            </p>
          </div>
        )}

        {state.kind === "error" && (
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
        )}

        <DialogFooter>
          {state.kind === "form" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={selectionSummary.count === 0}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!canCreate}
              >
                Create link
              </Button>
            </>
          )}
          {state.kind === "result" && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ShareDialog;