import * as React from "react";
import { ArrowDown, ArrowUp, Heart, Loader2, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { Button } from "@src/components/ui/button";
import { Input } from "@src/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@src/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@src/components/ui/tooltip";
import { ConfirmDialog } from "@src/components/ui/confirm-dialog";
import { cn } from "@src/lib/utils";
import { showErrorToast, showSuccessToast } from "@src/utils/toast-feedback";
import { SectionHeading } from "../SettingsPrimitives";

type TagRow = { id: string; name: string; color?: string | null; isFavorite?: boolean; tabCount: number };
type SortKey = "name" | "tabCount";

// 4×4 palette matching the reference picker.
const TAG_COLORS = [
  "#6b7280", "#64748b", "#ef4444", "#f97316",
  "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
];

const callTags = async <T,>(type: string, payload: unknown): Promise<T> => {
  const res = await chrome.runtime.sendMessage({ service: "tags", type, target: "offscreen", payload });
  if (!res?.success) throw new Error(res?.error || `${type} failed`);
  return res.payload as T;
};

export function TagsSection() {
  const [tags, setTags] = React.useState<TagRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sortKey, setSortKey] = React.useState<SortKey>("name");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<TagRow | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      setTags(await callTags<TagRow[]>("listAllTags", {}));
    } catch {
      showErrorToast("Could not load tags.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = React.useMemo(() => {
    const rows = [...tags];
    rows.sort((a, b) => {
      const cmp = sortKey === "name" ? a.name.localeCompare(b.name) : a.tabCount - b.tabCount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [tags, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (!name) return;
    try {
      await callTags("createTag", { name });
      await refresh();
      showSuccessToast("Tag created.", { tempo: "quick" });
    } catch {
      showErrorToast("Could not create tag.");
    }
  };

  const handleColor = async (tag: TagRow, color: string) => {
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, color } : t)));
    try {
      await callTags("setTagColor", { tagId: tag.id, color });
    } catch {
      showErrorToast("Could not update color.");
      void refresh();
    }
  };

  const handleFavorite = async (tag: TagRow) => {
    const next = !tag.isFavorite;
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, isFavorite: next } : t)));
    try {
      await callTags("setTagFavorite", { tagId: tag.id, isFavorite: next });
    } catch {
      showErrorToast("Could not update favorite.");
      void refresh();
    }
  };

  const handleRename = async (tag: TagRow) => {
    const name = editingName.trim();
    setEditingId(null);
    if (!name || name === tag.name) return;
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, name } : t)));
    try {
      await callTags("renameTag", { tagId: tag.id, name });
    } catch {
      showErrorToast("Could not rename tag.");
      void refresh();
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await callTags("deleteTag", { tagId: target.id });
      await refresh();
      showSuccessToast("Tag deleted.", { tempo: "quick" });
    } catch {
      showErrorToast("Could not delete tag.");
    }
  };

  const SortHeader = ({ label, sortKey: key, className }: { label: string; sortKey: SortKey; className?: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={cn("inline-flex items-center gap-1 text-[13px] font-medium text-foreground-secondary hover:text-foreground-neutral", className)}
    >
      {label}
      {sortKey === key &&
        (sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
    </button>
  );

  return (
    <div>
      <SectionHeading
        title="Tags"
        description="Color-code and organize your tags. Counts reflect how many tabs carry each tag."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New tag
          </Button>
        }
      />

      {/* Column header */}
      <div className="mt-4 flex items-center gap-3 border-b border-border-neutral-faded px-2 pb-2">
        <TagIcon className="size-4 shrink-0 text-foreground-tertiary" />
        <div className="flex-1">
          <SortHeader label="Name" sortKey="name" />
        </div>
        <div className="w-20 text-right">
          <SortHeader label="Tab count" sortKey="tabCount" className="justify-end" />
        </div>
        <div className="w-16" />
      </div>

      {creating && (
        <div className="flex items-center gap-3 border-b border-border-neutral-faded px-2 py-2">
          <span className="size-4 shrink-0 rounded-full border border-border-neutral" />
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => void handleCreate()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            placeholder="Tag name…"
            className="h-8 flex-1 text-[14px]"
            aria-label="New tag name"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-foreground-secondary">
          <Loader2 className="size-4 animate-spin" />
          Loading tags…
        </div>
      ) : sorted.length === 0 && !creating ? (
        <div className="px-2 py-10 text-center text-sm text-foreground-secondary">
          <TagIcon className="mx-auto mb-2 size-5 text-foreground-tertiary" />
          No tags yet. Create one to start organizing.
        </div>
      ) : (
        <ul>
          {sorted.map((tag) => (
            <li
              key={tag.id}
              className="group flex items-center gap-3 border-b border-border-neutral-faded px-2 py-2.5 transition-colors hover:bg-background-neutral-faded/40"
            >
              {/* Color swatch + picker */}
              <Popover>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Change color for ${tag.name}`}
                          className="size-4 shrink-0 rounded-full outline-none ring-offset-1 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-border-neutral"
                          style={{ backgroundColor: tag.color || "#cbd5e1" }}
                        />
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Set color</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Set color ${color}`}
                        onClick={() => void handleColor(tag, color)}
                        className="size-7 rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-border-neutral"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Name (double-click to rename) */}
              <div className="min-w-0 flex-1">
                {editingId === tag.id ? (
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => void handleRename(tag)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename(tag);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-7 text-[14px]"
                    aria-label="Rename tag"
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => {
                      setEditingId(tag.id);
                      setEditingName(tag.name);
                    }}
                    title="Double-click to rename"
                    className="block max-w-full truncate text-left text-[14px] text-foreground-neutral"
                  >
                    {tag.name}
                  </button>
                )}
              </div>

              <div className="w-20 text-right text-[14px] tabular-nums text-foreground-secondary">{tag.tabCount}</div>

              <div className="flex w-16 items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => void handleFavorite(tag)}
                  aria-label={tag.isFavorite ? "Unfavorite" : "Favorite"}
                  aria-pressed={tag.isFavorite}
                  className={cn(
                    "grid size-7 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-neutral",
                    tag.isFavorite ? "text-accent" : "text-foreground-tertiary hover:text-foreground-secondary"
                  )}
                >
                  <Heart className={cn("size-4", tag.isFavorite && "fill-accent")} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(tag)}
                  aria-label={`Delete ${tag.name}`}
                  className="grid size-7 place-items-center rounded-full text-foreground-tertiary outline-none transition-colors hover:text-foreground-danger focus-visible:ring-2 focus-visible:ring-border-neutral"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Delete the "${deleteTarget.name}" tag?` : ""}
        description="The tag is removed from every tab it's on. The tabs themselves are kept. This cannot be undone."
        confirmLabel="Delete tag"
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
