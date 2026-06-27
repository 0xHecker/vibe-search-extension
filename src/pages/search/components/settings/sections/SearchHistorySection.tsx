import * as React from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@src/components/ui/button";
import { ConfirmDialog } from "@src/components/ui/confirm-dialog";
import { SectionHeading, SettingGroup, SettingRow, SettingSwitch } from "../SettingsPrimitives";

/** localStorage key for the "save search history" preference (default on). */
export const SAVE_HISTORY_STORAGE_KEY = "vibesearch:saveSearchHistory";

/** Read the preference; defaults to true when unset. */
export const isSearchHistoryEnabled = (): boolean => {
  try {
    return localStorage.getItem(SAVE_HISTORY_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
};

export interface SearchHistorySectionProps {
  recentQueryCount: number;
  onClearHistory: () => Promise<void> | void;
  onOpenBin: () => void;
}

export function SearchHistorySection({
  recentQueryCount,
  onClearHistory,
  onOpenBin,
}: SearchHistorySectionProps) {
  const [saveHistory, setSaveHistory] = React.useState(isSearchHistoryEnabled);
  const [clearOpen, setClearOpen] = React.useState(false);

  const toggleSaveHistory = (next: boolean) => {
    setSaveHistory(next);
    try {
      localStorage.setItem(SAVE_HISTORY_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <SectionHeading
        title="Search history & bin"
        description="Control what the search bar remembers, and recover spaces you've moved to the bin."
      />

      <SettingGroup label="Search history">
        <SettingRow
          title="Save search history"
          description="Remember recent queries so the search bar can suggest them. Turning this off stops new queries from being saved."
        >
          <SettingSwitch checked={saveHistory} onCheckedChange={toggleSaveHistory} label="Save search history" />
        </SettingRow>

        <SettingRow
          title="Clear search history"
          description={
            recentQueryCount > 0
              ? `Remove all ${recentQueryCount} remembered ${recentQueryCount === 1 ? "query" : "queries"} from this device.`
              : "No queries are currently saved."
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={recentQueryCount === 0}
            onClick={() => setClearOpen(true)}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="Bin">
        <SettingRow
          title="Recently deleted"
          description="Spaces and groups you've removed are kept here for a while so you can restore them."
        >
          <Button type="button" variant="outline" size="sm" onClick={onOpenBin}>
            Open bin
            <ChevronRight className="size-4" />
          </Button>
        </SettingRow>
      </SettingGroup>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear search history?"
        description="Your remembered queries are removed from this device. This cannot be undone."
        confirmLabel="Clear history"
        variant="danger"
        onConfirm={onClearHistory}
      />
    </div>
  );
}
