import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@src/lib/utils";

type DatePickerProps = {
  mode: "single" | "range";
  onSelect: (value: Date | { from: Date; to: Date }) => void;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const startOfToday = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const DatePicker = ({ mode, onSelect }: DatePickerProps) => {
  const today = useMemo(startOfToday, []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);

  const cells = useMemo(() => {
    const startOffset = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
    return Array.from(
      { length: 42 },
      (_, i) => new Date(view.getFullYear(), view.getMonth(), i - startOffset + 1)
    );
  }, [view]);

  const shiftMonth = (delta: number) =>
    setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));

  const handleClick = (day: Date) => {
    if (mode === "single") {
      onSelect(day);
      return;
    }
    if (!pendingFrom) {
      setPendingFrom(day);
      return;
    }
    const [from, to] = pendingFrom <= day ? [pendingFrom, day] : [day, pendingFrom];
    onSelect({ from, to });
    setPendingFrom(null);
  };

  const inPreview = (day: Date): boolean => {
    if (mode !== "range" || !pendingFrom || !hovered) return false;
    const lo = pendingFrom <= hovered ? pendingFrom : hovered;
    const hi = pendingFrom <= hovered ? hovered : pendingFrom;
    return day >= lo && day <= hi;
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
          className="grid size-8 place-items-center rounded-md text-foreground-secondary transition-colors hover:bg-background-highlight active:scale-[0.96]"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-foreground-neutral">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
          className="grid size-8 place-items-center rounded-md text-foreground-secondary transition-colors hover:bg-background-highlight active:scale-[0.96]"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground-tertiary"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHovered(null)}>
        {cells.map((day) => {
          const outside = day.getMonth() !== view.getMonth();
          const isToday = sameDay(day, today);
          const isFrom = !!pendingFrom && sameDay(day, pendingFrom);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => handleClick(day)}
              onMouseEnter={() => setHovered(day)}
              className={cn(
                "grid size-9 place-items-center rounded-md text-sm tabular-nums transition-colors",
                outside ? "text-foreground-tertiary" : "text-foreground-neutral",
                inPreview(day) && "bg-accent-faded/60",
                isFrom ? "bg-accent text-white" : "hover:bg-background-highlight",
                isToday && !isFrom && "font-semibold text-accent"
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {mode === "range" && (
        <div className="mt-2 text-center text-[11px] text-foreground-secondary">
          {pendingFrom ? "Pick the end date" : "Pick the start date"}
        </div>
      )}
    </div>
  );
};
