import { List, LayoutGrid } from "lucide-react";
import { cn } from "@src/lib/utils";

interface ViewToggleProps {
  view: "list" | "grid";
  onViewChange: (view: "list" | "grid") => void;
}

export const ViewToggle = ({ view, onViewChange }: ViewToggleProps) => {
  return (
    <div className="flex items-center bg-background-neutral rounded-lg p-0.5 border border-border-neutral-faded">
      <button
        type="button"
        onClick={() => onViewChange("list")}
        className={cn(
          "p-1.5 rounded-md transition-all duration-200",
          view === "list"
            ? "bg-foreground-neutral text-background-neutral shadow-sm"
            : "text-foreground-tertiary hover:text-foreground-secondary"
        )}
        aria-label="List view"
        title="List view"
      >
        <List size={14} />
      </button>
      <button
        type="button"
        onClick={() => onViewChange("grid")}
        className={cn(
          "p-1.5 rounded-md transition-all duration-200",
          view === "grid"
            ? "bg-foreground-neutral text-background-neutral shadow-sm"
            : "text-foreground-tertiary hover:text-foreground-secondary"
        )}
        aria-label="Grid view"
        title="Grid view"
      >
        <LayoutGrid size={14} />
      </button>
    </div>
  );
};

