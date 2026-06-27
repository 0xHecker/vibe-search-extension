import * as React from "react";
import {
  Boxes,
  Calendar,
  Check,
  ChevronDown,
  CircleSlash,
  Globe,
  Globe2,
  Hash,
  Image as ImageIcon,
  Layers,
  Lock,
  PlaySquare,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareStack,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@src/components/ui/popover";
import { cn } from "@src/lib/utils";
import {
  getQueryModeFeatures,
  parseQueryMode,
  QUERY_MODE_DEFINITIONS,
} from "@src/search-core/contracts";
import type { QueryMode, QueryModeFeatures, QueryScope } from "@src/search-core/contracts";
import type { SearchSpaceInfo, SearchCollectionInfo } from "./SearchResults";

/* ─────────────────────────── shared primitives ─────────────────────────── */

const chipBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-neutral/70";
const chipQuiet =
  "border-border-neutral-faded text-foreground-secondary hover:bg-background-neutral-faded hover:text-foreground-neutral";
const chipActive = "border-accent/40 bg-accent-faded text-accent";

const chipClass = (active: boolean) => cn(chipBase, active ? chipActive : chipQuiet);

const popoverHeading =
  "px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-tertiary";

const CountBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
      {count}
    </span>
  ) : null;

function OptionRow({
  icon,
  label,
  hint,
  active,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-accent-faded text-accent" : "text-foreground-neutral hover:bg-background-neutral-faded"
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center", active ? "text-accent" : "text-foreground-tertiary")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint && <span className="ml-1 text-foreground-tertiary">· {hint}</span>}
      </span>
      {active && <Check size={14} className="shrink-0 text-accent" />}
    </button>
  );
}

function CheckRow({
  checked,
  label,
  hint,
  dotColor,
  onToggle,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  dotColor?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-background-neutral-faded"
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
          checked ? "border-accent bg-accent text-white" : "border-border-neutral"
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      {dotColor && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />}
      <span className="min-w-0 flex-1 truncate text-foreground-neutral">
        {label}
        {hint && <span className="ml-1 text-foreground-tertiary">{hint}</span>}
      </span>
    </button>
  );
}

/** Search box + scrollable, filterable check list (tags, sites). */
function FilterList({
  placeholder,
  options,
  selected,
  onToggle,
  emptyLabel,
}: {
  placeholder: string;
  options: Array<{ value: string; label: string; dotColor?: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  emptyLabel: string;
}) {
  const [query, setQuery] = React.useState("");
  const selectedSet = React.useMemo(
    () => new Set(selected.map((value) => value.toLowerCase())),
    [selected]
  );
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options;
  // Selected first, then alphabetical, so active filters stay visible.
  const ordered = [...filtered].sort((a, b) => {
    const sa = selectedSet.has(a.value.toLowerCase()) ? 0 : 1;
    const sb = selectedSet.has(b.value.toLowerCase()) ? 0 : 1;
    return sa - sb || a.label.localeCompare(b.label);
  });

  return (
    <div>
      <div className="relative px-1 pb-1.5">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-tertiary" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-border-neutral-faded bg-background-page-secondary/60 pl-8 pr-2 text-[13px] text-foreground-neutral outline-none placeholder:text-foreground-tertiary focus-visible:ring-2 focus-visible:ring-border-neutral/50"
        />
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-subtle px-1">
        {ordered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-foreground-tertiary">{emptyLabel}</p>
        ) : (
          ordered.map((option) => (
            <CheckRow
              key={option.value}
              checked={selectedSet.has(option.value.toLowerCase())}
              label={option.label}
              dotColor={option.dotColor}
              onToggle={() => onToggle(option.value)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Scope ──────────────────────────────── */

export type SearchScopeMenuProps = {
  scope: QueryScope;
  label: string;
  spaceName?: string;
  isDefault: boolean;
  onChange: (scope: QueryScope) => void;
  onSetDefault: (scope: QueryScope) => void;
};

export function SearchScopeMenu({ scope, label, spaceName, isDefault, onChange, onSetDefault }: SearchScopeMenuProps) {
  return (
    <Popover>
      <PopoverTrigger className={chipClass(!isDefault)} title="Search scope">
        <Globe2 size={12} />
        <span className="max-w-[12rem] truncate">{label}</span>
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        <p className={popoverHeading}>Search in</p>
        <OptionRow icon={<Globe2 size={15} />} label="Everywhere" active={scope === "global"} onSelect={() => onChange("global")} />
        <OptionRow icon={<Square size={15} />} label="This space" hint={spaceName} active={scope === "current"} onSelect={() => onChange("current")} />
        <div className="my-1 h-px bg-border-neutral-faded" />
        <OptionRow icon={<Lock size={15} />} label="Private only" active={scope === "private"} onSelect={() => onChange("private")} />
        <OptionRow icon={<Globe size={15} />} label="Public only" active={scope === "public"} onSelect={() => onChange("public")} />
        <div className="my-1 h-px bg-border-neutral-faded" />
        <button
          type="button"
          disabled={isDefault}
          onClick={() => onSetDefault(scope)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground-secondary transition-colors hover:bg-background-neutral-faded disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
        >
          <Sparkles size={13} className="text-foreground-tertiary" />
          {isDefault ? "Default scope" : "Set as default"}
        </button>
        <p className="px-2 pt-1 text-[11px] leading-snug text-foreground-tertiary">
          Tip: pick specific spaces with the Spaces filter.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── Mode ──────────────────────────────── */

export const MODE_LABELS: Record<QueryMode, string> = {
  keyword: "Keyword",
  fuzzy: "Fuzzy",
  vector: "Semantic",
  "keyword+fuzzy": "Keyword + Fuzzy",
  "keyword+vector": "Hybrid",
  "fuzzy+vector": "Fuzzy + Semantic",
  "keyword+fuzzy+vector": "Everything",
};

const MODE_SIGNALS: Array<[keyof QueryModeFeatures, string]> = [
  ["keyword", "Keyword"],
  ["vector", "Semantic"],
  ["fuzzy", "Fuzzy"],
];

const MODE_QUICK: Array<{ mode: QueryMode; label: string }> = [
  { mode: "keyword+vector", label: "Hybrid" },
  { mode: "keyword+fuzzy+vector", label: "Everything" },
];

const composeMode = (features: QueryModeFeatures): QueryMode => {
  const parts = [features.keyword && "keyword", features.fuzzy && "fuzzy", features.vector && "vector"]
    .filter(Boolean)
    .join("+");
  return parseQueryMode(parts) ?? "keyword";
};

export type SearchModeMenuProps = {
  mode: QueryMode;
  isDefault: boolean;
  onModeChange: (mode: QueryMode) => void;
  onSetDefault: (mode: QueryMode) => void;
};

export function SearchModeMenu({ mode, isDefault, onModeChange, onSetDefault }: SearchModeMenuProps) {
  const features = getQueryModeFeatures(mode);
  const toggle = (key: keyof QueryModeFeatures, next: boolean) =>
    onModeChange(composeMode({ ...features, [key]: next }));

  return (
    <Popover>
      <PopoverTrigger className={chipClass(!isDefault)} title="Search mode">
        <Sparkles size={12} />
        <span className="max-w-[10rem] truncate">{MODE_LABELS[mode]}</span>
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <p className={popoverHeading}>Search mode</p>
        {/* Signals — multi-select toggles. */}
        <div className="grid grid-cols-3 gap-1 px-1">
          {MODE_SIGNALS.map(([key, label]) => {
            const active = features[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(key, !active)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors",
                  active
                    ? "border-accent/40 bg-accent-faded text-accent"
                    : "border-border-neutral-faded text-foreground-secondary hover:bg-background-neutral-faded hover:text-foreground-neutral"
                )}
              >
                <span
                  className={cn(
                    "grid size-4 place-items-center rounded-full border",
                    active ? "border-accent bg-accent text-white" : "border-border-neutral"
                  )}
                >
                  {active && <Check size={10} strokeWidth={3} />}
                </span>
                {label}
              </button>
            );
          })}
        </div>
        <p className="px-2 pt-1.5 text-[11px] text-foreground-tertiary">Combine any — at least one stays on.</p>
        <div className="my-1.5 h-px bg-border-neutral-faded" />
        <div className="flex gap-1 px-1">
          {MODE_QUICK.map((preset) => (
            <button
              key={preset.mode}
              type="button"
              onClick={() => onModeChange(preset.mode)}
              className={cn(
                "flex-1 rounded-md border px-2 py-1.5 text-[12px] font-medium transition-colors",
                mode === preset.mode
                  ? "border-accent/40 bg-accent-faded text-accent"
                  : "border-border-neutral-faded text-foreground-secondary hover:bg-background-neutral-faded hover:text-foreground-neutral"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="my-1.5 h-px bg-border-neutral-faded" />
        <p className="px-2 pb-1 text-[11px] leading-snug text-foreground-tertiary">
          {QUERY_MODE_DEFINITIONS[mode].description}
        </p>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => onSetDefault(mode)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground-secondary transition-colors hover:bg-background-neutral-faded disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
        >
          <Sparkles size={13} className="text-foreground-tertiary" />
          {isDefault ? "Default mode" : "Set as default"}
        </button>
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── Spaces ──────────────────────────────── */

export type SearchSpacesMenuProps = {
  spaces: SearchSpaceInfo[];
  collections: SearchCollectionInfo[];
  selected: string[];
  onToggle: (spaceName: string) => void;
  onSelectCollection: (spaceNames: string[]) => void;
};

export function SearchSpacesMenu({ spaces, collections, selected, onToggle, onSelectCollection }: SearchSpacesMenuProps) {
  const selectedSet = React.useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const collectionName = React.useMemo(
    () => new Map(collections.map((c) => [c.id, c.name])),
    [collections]
  );
  const groups = React.useMemo(() => {
    const byCollection = new Map<string, SearchSpaceInfo[]>();
    for (const space of spaces) {
      const key = space.spaceGroupId ?? "__none__";
      const list = byCollection.get(key) ?? [];
      list.push(space);
      byCollection.set(key, list);
    }
    return Array.from(byCollection.entries());
  }, [spaces]);

  return (
    <Popover>
      <PopoverTrigger className={chipClass(selected.length > 0)} title="Spaces">
        <SquareStack size={12} />
        <span>Spaces</span>
        <CountBadge count={selected.length} />
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <p className={popoverHeading}>Search in spaces</p>
        <div className="max-h-64 overflow-y-auto scrollbar-subtle px-1">
          {groups.map(([key, list]) => (
            <div key={key} className="pb-1">
              {key !== "__none__" && collectionName.get(key) && (
                <div className="flex items-center justify-between px-2 pb-0.5 pt-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground-tertiary">
                    <Boxes size={11} />
                    {collectionName.get(key)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectCollection(list.map((space) => space.name))}
                    className="text-[10px] font-medium text-accent transition-opacity hover:opacity-80"
                  >
                    Select all
                  </button>
                </div>
              )}
              {list.map((space) => (
                <CheckRow
                  key={space.id}
                  checked={selectedSet.has(space.name.toLowerCase())}
                  label={space.name}
                  onToggle={() => onToggle(space.name)}
                />
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── Tags ──────────────────────────────── */

export type SearchTagsMenuProps = {
  tags: Array<{ id: string; name: string; color?: string | null }>;
  selected: string[];
  onToggle: (name: string) => void;
};

export function SearchTagsMenu({ tags, selected, onToggle }: SearchTagsMenuProps) {
  return (
    <Popover>
      <PopoverTrigger className={chipClass(selected.length > 0)} title="Tags">
        <Hash size={12} />
        <span>Tags</span>
        <CountBadge count={selected.length} />
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <p className={popoverHeading}>Filter by tag</p>
        <FilterList
          placeholder="Find a tag…"
          options={tags.map((tag) => ({
            value: tag.name,
            label: tag.name,
            dotColor: tag.color ?? undefined,
          }))}
          selected={selected}
          onToggle={onToggle}
          emptyLabel="No tags yet."
        />
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── Sites ──────────────────────────────── */

export type SearchSitesMenuProps = {
  domains: string[];
  selected: string[];
  onToggle: (domain: string) => void;
};

export function SearchSitesMenu({ domains, selected, onToggle }: SearchSitesMenuProps) {
  return (
    <Popover>
      <PopoverTrigger className={chipClass(selected.length > 0)} title="Sites">
        <Globe size={12} />
        <span>Sites</span>
        <CountBadge count={selected.length} />
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <p className={popoverHeading}>Filter by site</p>
        <FilterList
          placeholder="Find a site…"
          options={domains.map((domain) => ({ value: domain, label: domain }))}
          selected={selected}
          onToggle={onToggle}
          emptyLabel="No sites yet."
        />
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── Dates ──────────────────────────────── */

const DATE_PRESETS: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7d", label: "Last 7 days" },
  { value: "last30d", label: "Last 30 days" },
];

const DATE_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7d: "Last 7 days",
  last30d: "Last 30 days",
};

export type SearchDatesMenuProps = {
  active: string | null;
  onSet: (value: string | null) => void;
};

export function SearchDatesMenu({ active, onSet }: SearchDatesMenuProps) {
  const label = active ? DATE_LABELS[active] ?? "Custom" : "Date";
  return (
    <Popover>
      <PopoverTrigger className={chipClass(!!active)} title="Date added">
        <Calendar size={12} />
        <span className="max-w-[8rem] truncate">{label}</span>
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <p className={popoverHeading}>Date added</p>
        {DATE_PRESETS.map((preset) => (
          <OptionRow
            key={preset.value}
            icon={<Calendar size={15} />}
            label={preset.label}
            active={active === preset.value}
            onSelect={() => onSet(active === preset.value ? null : preset.value)}
          />
        ))}
        {active && (
          <>
            <div className="my-1 h-px bg-border-neutral-faded" />
            <button
              type="button"
              onClick={() => onSet(null)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground-secondary transition-colors hover:bg-background-neutral-faded"
            >
              <CircleSlash size={13} className="text-foreground-tertiary" />
              Clear date
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── Media ──────────────────────────────── */

const MEDIA_OPTIONS: Array<{ value: string; label: string; icon: React.ReactNode }> = [
  { value: "image", label: "Images", icon: <ImageIcon size={15} /> },
  { value: "video", label: "Videos", icon: <PlaySquare size={15} /> },
  { value: "embed", label: "Embeds", icon: <Layers size={15} /> },
  { value: "media", label: "Any media", icon: <ImageIcon size={15} /> },
];

export type SearchMediaMenuProps = {
  selected: string[];
  onToggle: (value: string) => void;
};

export function SearchMediaMenu({ selected, onToggle }: SearchMediaMenuProps) {
  const selectedSet = new Set(selected);
  return (
    <Popover>
      <PopoverTrigger className={chipClass(selected.length > 0)} title="Media">
        <ImageIcon size={12} />
        <span>Media</span>
        <CountBadge count={selected.length} />
        <ChevronDown size={11} className="opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <p className={popoverHeading}>Contains media</p>
        {MEDIA_OPTIONS.map((option) => (
          <CheckRow
            key={option.value}
            checked={selectedSet.has(option.value)}
            label={option.label}
            onToggle={() => onToggle(option.value)}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* ─────────────────────────── Controls bar (entry) ─────────────────────────── */

const CONTROLS_OPEN_KEY = "vibe-search-controls-open";

export type SearchControlsBarProps = {
  scope: QueryScope;
  scopeLabel: string;
  spaceName?: string;
  scopeIsDefault: boolean;
  onScopeChange: (scope: QueryScope) => void;
  onSetDefaultScope: (scope: QueryScope) => void;

  mode: QueryMode;
  modeIsDefault: boolean;
  onModeChange: (mode: QueryMode) => void;
  onSetDefaultMode: (mode: QueryMode) => void;

  spaces: SearchSpaceInfo[];
  collections: SearchCollectionInfo[];
  tags: Array<{ id: string; name: string; color?: string | null }>;
  domains: string[];

  selectedSpaceNames: string[];
  selectedTags: string[];
  selectedSites: string[];
  selectedMedia: string[];
  activeDate: string | null;

  onToggleSpace: (name: string) => void;
  onSelectSpaces: (names: string[]) => void;
  onToggleTag: (name: string) => void;
  onToggleSite: (domain: string) => void;
  onToggleMedia: (value: string) => void;
  onSetDate: (value: string | null) => void;
  onClearFilters: () => void;
};

export function SearchControlsBar(props: SearchControlsBarProps) {
  const [open, setOpen] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(CONTROLS_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(CONTROLS_OPEN_KEY, open ? "1" : "0");
    } catch {}
  }, [open]);

  const filterCount =
    props.selectedSpaceNames.length +
    props.selectedTags.length +
    props.selectedSites.length +
    props.selectedMedia.length +
    (props.activeDate ? 1 : 0) +
    (props.scopeIsDefault ? 0 : 1) +
    (props.modeIsDefault ? 0 : 1);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={chipClass(open || filterCount > 0)}
        title="Search filters"
      >
        <SlidersHorizontal size={12} />
        <span>Filters</span>
        <CountBadge count={filterCount} />
        <ChevronDown size={11} className={cn("opacity-70 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <SearchScopeMenu
            scope={props.scope}
            label={props.scopeLabel}
            spaceName={props.spaceName}
            isDefault={props.scopeIsDefault}
            onChange={props.onScopeChange}
            onSetDefault={props.onSetDefaultScope}
          />
          <SearchModeMenu
            mode={props.mode}
            isDefault={props.modeIsDefault}
            onModeChange={props.onModeChange}
            onSetDefault={props.onSetDefaultMode}
          />
          <SearchSpacesMenu
            spaces={props.spaces}
            collections={props.collections}
            selected={props.selectedSpaceNames}
            onToggle={props.onToggleSpace}
            onSelectCollection={props.onSelectSpaces}
          />
          <SearchTagsMenu tags={props.tags} selected={props.selectedTags} onToggle={props.onToggleTag} />
          <SearchSitesMenu domains={props.domains} selected={props.selectedSites} onToggle={props.onToggleSite} />
          <SearchDatesMenu active={props.activeDate} onSet={props.onSetDate} />
          <SearchMediaMenu selected={props.selectedMedia} onToggle={props.onToggleMedia} />
          {filterCount > 0 && (
            <button
              type="button"
              onClick={props.onClearFilters}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-foreground-tertiary transition-colors hover:bg-background-neutral-faded hover:text-foreground-danger"
              title="Clear all filters"
            >
              <CircleSlash size={12} />
              Clear
            </button>
          )}
        </>
      )}
    </div>
  );
}
