import * as React from "react";
import { getQueryModeFeatures, parseQueryMode } from "@src/search-core/contracts";
import type { QueryMode, QueryModeFeatures, QueryScope } from "@src/search-core/contracts";
import {
  setDefaultSearchMode,
  setDefaultSearchScope,
  useDefaultSearchMode,
  useDefaultSearchScope,
} from "@src/pages/search/search-preferences";
import { cn } from "@src/lib/utils";
import { SectionHeading, SettingGroup, SettingRow, SettingSwitch } from "../SettingsPrimitives";

const MODE_PRESETS: Array<{ mode: QueryMode; label: string }> = [
  { mode: "keyword+vector", label: "Hybrid" },
  { mode: "keyword", label: "Keyword" },
  { mode: "vector", label: "Semantic" },
  { mode: "fuzzy", label: "Fuzzy" },
];

const SCOPE_OPTIONS: Array<{ scope: QueryScope; label: string }> = [
  { scope: "global", label: "Everywhere" },
  { scope: "current", label: "This space" },
  { scope: "private", label: "Private" },
  { scope: "public", label: "Public" },
];

const composeMode = (features: QueryModeFeatures): QueryMode => {
  const parts = [
    features.keyword && "keyword",
    features.fuzzy && "fuzzy",
    features.vector && "vector",
  ]
    .filter(Boolean)
    .join("+");
  return parseQueryMode(parts) ?? "keyword";
};

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-neutral/60",
        active
          ? "border-accent/40 bg-accent-faded text-accent"
          : "border-border-neutral-faded text-foreground-secondary hover:bg-background-neutral-faded hover:text-foreground-neutral"
      )}
    >
      {children}
    </button>
  );
}

export function SearchSettingsSection() {
  const defaultMode = useDefaultSearchMode();
  const defaultScope = useDefaultSearchScope();
  const features = getQueryModeFeatures(defaultMode);

  const toggle = (key: keyof QueryModeFeatures, next: boolean) =>
    setDefaultSearchMode(composeMode({ ...features, [key]: next }));

  return (
    <div>
      <SectionHeading
        title="Search"
        description="Set how search behaves by default. You can still override either of these per-search from the chips on the search bar."
      />

      <SettingGroup label="Default mode">
        <div className="py-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {MODE_PRESETS.map((preset) => (
              <SegmentButton
                key={preset.mode}
                active={defaultMode === preset.mode}
                onClick={() => setDefaultSearchMode(preset.mode)}
              >
                {preset.label}
              </SegmentButton>
            ))}
          </div>
          <p className="mt-2 px-0.5 text-[12px] leading-relaxed text-foreground-tertiary">
            Hybrid blends keyword and semantic search — a strong default. Fine-tune the exact mix below.
          </p>
        </div>

        <SettingRow title="Keyword" description="Exact words and field matches.">
          <SettingSwitch
            checked={features.keyword}
            onCheckedChange={(next) => toggle("keyword", next)}
            label="Keyword"
          />
        </SettingRow>
        <SettingRow title="Semantic" description="Meaning and related concepts (vector).">
          <SettingSwitch
            checked={features.vector}
            onCheckedChange={(next) => toggle("vector", next)}
            label="Semantic"
          />
        </SettingRow>
        <SettingRow title="Fuzzy" description="Typos, prefixes, and near-matches.">
          <SettingSwitch
            checked={features.fuzzy}
            onCheckedChange={(next) => toggle("fuzzy", next)}
            label="Fuzzy"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="Default scope">
        <div className="py-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {SCOPE_OPTIONS.map((option) => (
              <SegmentButton
                key={option.scope}
                active={defaultScope === option.scope}
                onClick={() => setDefaultSearchScope(option.scope)}
              >
                {option.label}
              </SegmentButton>
            ))}
          </div>
          <p className="mt-2 px-0.5 text-[12px] leading-relaxed text-foreground-tertiary">
            Everywhere searches across all your spaces. Narrow to a single space, collection, or
            folder anytime from the scope chip.
          </p>
        </div>
      </SettingGroup>
    </div>
  );
}
