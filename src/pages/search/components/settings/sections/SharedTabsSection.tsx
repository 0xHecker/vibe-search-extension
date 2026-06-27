import * as React from "react";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@src/components/ui/button";
import { Input } from "@src/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@src/components/ui/dialog";
import { ConfirmDialog } from "@src/components/ui/confirm-dialog";
import { cn } from "@src/lib/utils";
import {
  forgetShareLink,
  getOwnedShareDetail,
  getRememberedShareLinks,
  getStoredOwnerMeta,
  listOwnedShares,
  revokeShare,
  rotateShareOwnerToken,
  setShareExpiry,
  setSharePin,
  ShareApiError,
  type OwnedShareDetail,
  type OwnedShareSummary,
} from "@src/services/share.service";
import {
  resolveToastErrorMessage,
  showErrorToast,
  showLoadingToast,
  showSuccessToast,
  withToast,
} from "@src/utils/toast-feedback";
import { SectionHeading } from "../SettingsPrimitives";

const formatDate = (ms: number | null | undefined) => {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return "—";
  }
};

const DAY_MS = 86_400_000;

const expiryStatusText = (expiresAt?: number | null) => {
  if (!expiresAt) return "Permanent";
  return expiresAt < Date.now() ? `Expired ${formatDate(expiresAt)}` : `Expires ${formatDate(expiresAt)}`;
};

const PIN_REGEX = /^[A-Za-z0-9]{4,32}$/;

/** A real, openable capability link (not the worker's redacted placeholder). */
const isLiveShareUrl = (url?: string | null): boolean => !!url && !url.includes("<secret-hidden>");

export function SharedTabsSection() {
  const [shares, setShares] = React.useState<OwnedShareSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [ownerMeta, setOwnerMeta] = React.useState<{ ownerId: string | null; tokenHint: string | null }>({
    ownerId: null,
    tokenHint: null,
  });
  const [isRotateOpen, setIsRotateOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<OwnedShareDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<OwnedShareSummary | null>(null);
  const [copiedUrl, setCopiedUrl] = React.useState<string | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [pinEditing, setPinEditing] = React.useState(false);
  const [pinDraft, setPinDraft] = React.useState("");
  const [linkMap, setLinkMap] = React.useState<Record<string, string>>({});

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [meta, list, links] = await Promise.all([
        getStoredOwnerMeta(),
        listOwnedShares(),
        getRememberedShareLinks(),
      ]);
      setOwnerMeta({ ownerId: meta.ownerId, tokenHint: meta.tokenHint });
      setShares(list);
      setLinkMap(links);
    } catch (cause) {
      setError(resolveToastErrorMessage(cause, "Could not load shares."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = async (share: OwnedShareSummary) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await getOwnedShareDetail(share.shareId));
    } catch (cause) {
      showErrorToast(resolveToastErrorMessage(cause, "Could not load share detail."));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRotate = async () => {
    const toastId = showLoadingToast("Rotating owner token…");
    try {
      await rotateShareOwnerToken();
      const meta = await getStoredOwnerMeta();
      setOwnerMeta({ ownerId: meta.ownerId, tokenHint: meta.tokenHint });
      setIsRotateOpen(false);
      showSuccessToast("Token rotated. Existing shares keep working but can't be managed here under the old token.", {
        id: toastId,
        tempo: "long",
      });
      void refresh();
    } catch (cause) {
      showErrorToast(resolveToastErrorMessage(cause, "Token rotation failed."), { id: toastId });
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    await withToast({
      loading: "Revoking share…",
      success: "Share revoked. The public URL returns 410 Gone.",
      error: (err) =>
        err instanceof ShareApiError
          ? `${err.code}: ${err.message || "Worker refused to revoke."}`
          : resolveToastErrorMessage(err, "Revoke failed."),
      action: async () => {
        await revokeShare(revokeTarget.shareId);
      },
    });
    void forgetShareLink(revokeTarget.shareId);
    setRevokeTarget(null);
    setDetail(null);
    void refresh();
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl(null), 3000);
      showSuccessToast("Link copied.", { tempo: "quick" });
    } catch {
      showErrorToast("Could not copy link.");
    }
  };

  // The worker returns a redacted `<secret-hidden>` URL; prefer the real link we
  // captured locally when the share was created.
  const resolveShareUrl = React.useCallback(
    (share: { shareId: string; publicUrl: string }): string =>
      linkMap[share.shareId] ?? share.publicUrl,
    [linkMap]
  );

  const applyExpiry = async (deltaMs: number | null) => {
    if (!detail) return;
    const expiresAt = deltaMs === null ? null : Date.now() + deltaMs;
    setActionBusy(true);
    try {
      await setShareExpiry(detail.share.shareId, expiresAt);
      setDetail((prev) => (prev ? { ...prev, share: { ...prev.share, expiresAt } } : prev));
      showSuccessToast(expiresAt ? "Expiry updated." : "Share is permanent.", { tempo: "quick" });
      void refresh();
    } catch (cause) {
      showErrorToast(resolveToastErrorMessage(cause, "Could not update expiry."));
    } finally {
      setActionBusy(false);
    }
  };

  const applyPin = async () => {
    if (!detail) return;
    const pin = pinDraft.trim();
    if (!PIN_REGEX.test(pin)) {
      showErrorToast("PIN must be 4–32 letters or digits.");
      return;
    }
    setActionBusy(true);
    try {
      await setSharePin(detail.share.shareId, pin);
      setDetail((prev) => (prev ? { ...prev, share: { ...prev.share, requiresPin: true } } : prev));
      setPinEditing(false);
      setPinDraft("");
      showSuccessToast("PIN set. Share it separately.", { tempo: "quick" });
      void refresh();
    } catch (cause) {
      showErrorToast(resolveToastErrorMessage(cause, "Could not set PIN."));
    } finally {
      setActionBusy(false);
    }
  };

  const removePin = async () => {
    if (!detail) return;
    setActionBusy(true);
    try {
      await setSharePin(detail.share.shareId, null);
      setDetail((prev) => (prev ? { ...prev, share: { ...prev.share, requiresPin: false } } : prev));
      showSuccessToast("PIN removed.", { tempo: "quick" });
      void refresh();
    } catch (cause) {
      showErrorToast(resolveToastErrorMessage(cause, "Could not remove PIN."));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Shared tabs"
        description="Snapshots you've published. Copy or open their public links, see how often they're viewed, or revoke them."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={isLoading}>
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border-neutral-faded bg-background-page-secondary/60 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-tertiary">Owner token</p>
          <p className="mt-0.5 truncate font-mono text-xs text-foreground-secondary">
            id: {ownerMeta.ownerId ?? "—"} · hint: {ownerMeta.tokenHint ?? "—"}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsRotateOpen(true)}>
          <RotateCcw className="size-4" />
          Rotate
        </Button>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-foreground-secondary">
            <Loader2 className="size-4 animate-spin" />
            Loading shares…
          </div>
        ) : error ? (
          <div className="rounded-lg bg-background-danger-faded px-4 py-3 text-sm text-foreground-danger">{error}</div>
        ) : shares.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-neutral/60 px-4 py-10 text-center text-sm text-foreground-secondary">
            <Share2 className="mx-auto mb-2 size-5 text-foreground-tertiary" />
            No shares yet. Use the Share button in the sidebar to publish a snapshot.
          </div>
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <li
                key={share.shareId}
                className="rounded-lg border border-border-neutral-faded bg-background-neutral px-3 py-2.5 transition-colors hover:bg-background-neutral-faded/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => void openDetail(share)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <Share2 className="size-3.5 shrink-0 text-accent" />
                      <span className="truncate text-[14px] font-medium text-foreground-neutral">{share.title}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                          share.status === "active"
                            ? "bg-background-positive-faded text-foreground-positive"
                            : "bg-background-danger-faded text-foreground-danger"
                        )}
                      >
                        {share.status}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-secondary">
                      {share.requiresPin && (
                        <span className="inline-flex items-center gap-1 text-foreground-tertiary">
                          <KeyRound className="size-3" />
                          PIN
                        </span>
                      )}
                      {share.expiresAt && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            share.expiresAt < Date.now() ? "text-foreground-danger" : "text-foreground-tertiary"
                          )}
                        >
                          <Clock className="size-3" />
                          {share.expiresAt < Date.now() ? "Expired" : "Expires"}
                        </span>
                      )}
                      <span>{share.itemCount} tabs · {share.folderCount} groups</span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="size-3" />
                        {share.totalViews}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" />
                        {share.uniqueViewers}
                      </span>
                      <span className="text-foreground-tertiary">created {formatDate(share.createdAt)}</span>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {(() => {
                      const url = resolveShareUrl(share);
                      if (!isLiveShareUrl(url)) {
                        return (
                          <span
                            className="grid size-7 place-items-center text-foreground-tertiary"
                            title="The link is only stored on the device that created it — re-share to get a fresh link."
                          >
                            <KeyRound className="size-3.5" />
                          </span>
                        );
                      }
                      return (
                        <>
                          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => void copyUrl(url)} title="Copy link">
                            {copiedUrl === url ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          </Button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="grid size-7 place-items-center rounded-full text-foreground-secondary hover:bg-background-neutral-faded hover:text-foreground-neutral"
                            title="Open share"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </>
                      );
                    })()}
                    {share.status === "active" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-foreground-tertiary hover:text-foreground-danger"
                        onClick={() => setRevokeTarget(share)}
                        title="Revoke share"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!detail || detailLoading} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="sm:max-w-lg">
          {detailLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-foreground-secondary">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate">{detail.share.title}</DialogTitle>
                <DialogDescription>{detail.share.description || "Shared snapshot of selected tabs."}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Views" value={detail.analytics.totalViews} />
                  <Stat label="Unique" value={detail.analytics.uniqueViewers} />
                  <Stat label="Last viewed" value={formatDate(detail.share.lastViewedAt)} />
                </div>
                <div className="rounded-lg bg-background-page-secondary/60 px-3 py-2 text-xs text-foreground-secondary">
                  {isLiveShareUrl(resolveShareUrl(detail.share)) ? (
                    <p className="m-0 break-all">
                      <span className="text-foreground-tertiary">URL: </span>
                      <a href={resolveShareUrl(detail.share)} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                        {resolveShareUrl(detail.share)}
                      </a>
                    </p>
                  ) : (
                    <p className="m-0 text-foreground-tertiary">
                      The public link isn&apos;t stored on this device. Copy it from the share
                      dialog when you create a share, or re-share to get a fresh one.
                    </p>
                  )}
                  <p className="m-0 mt-1">
                    <span className="text-foreground-tertiary">Status: </span>
                    {detail.share.status} · <span className="text-foreground-tertiary">version</span> {detail.share.latestVersion} · {detail.items.length} items
                  </p>
                </div>

                {detail.share.status === "active" && (
                  <div className="space-y-3 rounded-lg border border-border-neutral-faded px-3 py-2.5">
                    {/* Link expiry */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground-neutral">Link expiry</span>
                        <span
                          className={cn(
                            "text-foreground-secondary",
                            detail.share.expiresAt && detail.share.expiresAt < Date.now() && "text-foreground-danger"
                          )}
                        >
                          {expiryStatusText(detail.share.expiresAt)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {([
                          ["Permanent", null],
                          ["1 day", DAY_MS],
                          ["7 days", 7 * DAY_MS],
                          ["30 days", 30 * DAY_MS],
                        ] as const).map(([label, delta]) => (
                          <Button
                            key={label}
                            type="button"
                            size="sm"
                            variant={!detail.share.expiresAt && delta === null ? "default" : "outline"}
                            disabled={actionBusy}
                            onClick={() => void applyExpiry(delta)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* PIN protection */}
                    <div className="border-t border-border-neutral-faded pt-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground-neutral">PIN protection</span>
                        <span className="text-foreground-secondary">{detail.share.requiresPin ? "On" : "Off"}</span>
                      </div>
                      {pinEditing ? (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Input
                            value={pinDraft}
                            onChange={(e) => setPinDraft(e.target.value)}
                            placeholder="4–32 letters or digits"
                            maxLength={32}
                            autoFocus
                            autoComplete="off"
                            className="h-8 flex-1 font-mono text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void applyPin();
                              if (e.key === "Escape") {
                                setPinEditing(false);
                                setPinDraft("");
                              }
                            }}
                          />
                          <Button type="button" size="sm" onClick={() => void applyPin()} disabled={actionBusy}>
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setPinEditing(false);
                              setPinDraft("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-2 flex gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={actionBusy}
                            onClick={() => {
                              setPinDraft("");
                              setPinEditing(true);
                            }}
                          >
                            {detail.share.requiresPin ? "Change PIN" : "Add PIN"}
                          </Button>
                          {detail.share.requiresPin && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-foreground-tertiary hover:text-foreground-danger"
                              disabled={actionBusy}
                              onClick={() => void removePin()}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                {isLiveShareUrl(resolveShareUrl(detail.share)) && (
                  <Button type="button" variant="outline" onClick={() => void copyUrl(resolveShareUrl(detail.share))}>
                    <Copy className="size-4" /> Copy link
                  </Button>
                )}
                {detail.share.status === "active" && (
                  <Button type="button" variant="destructive" onClick={() => setRevokeTarget(detail.share)}>
                    <Trash2 className="size-4" /> Revoke
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isRotateOpen}
        onOpenChange={setIsRotateOpen}
        title="Rotate owner token?"
        description="A new owner identity is registered. Existing shares keep serving at their public URLs, but you will no longer be able to manage or revoke them from this device."
        confirmLabel="Rotate"
        variant="warning"
        icon={KeyRound}
        onConfirm={handleRotate}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        title={revokeTarget ? `Revoke "${revokeTarget.title}"?` : ""}
        description="The public URL stops serving immediately and returns 410 Gone. This cannot be undone."
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevoke}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-background-page-secondary/60 px-2.5 py-2">
      <p className="m-0 text-[11px] uppercase tracking-[0.06em] text-foreground-tertiary">{label}</p>
      <p className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-foreground-neutral">{value}</p>
    </div>
  );
}
