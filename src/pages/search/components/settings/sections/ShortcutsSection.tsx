import * as React from "react";
import { SectionHeading, SettingGroup } from "../SettingsPrimitives";

const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌘" : "Ctrl";

type Shortcut = { label: string; description?: string; keys: string[]; global?: boolean };
type ShortcutGroup = { title: string; items: Shortcut[] };

const GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    items: [
      { label: "Focus search", description: "Jump to the search bar from anywhere", keys: ["/"] },
      { label: "Open settings", keys: [MOD, ","] },
      { label: "Open the popup", keys: [MOD, "Shift", "E"], global: true },
    ],
  },
  {
    title: "Organize",
    items: [{ label: "Toggle organize mode", description: "Drag to reorder & move tabs", keys: ["O"] }],
  },
  {
    title: "Quick actions",
    items: [
      { label: "Quick-save current tab", keys: [MOD, "Shift", "S"], global: true },
      { label: "Screenshot current tab", keys: [MOD, "Shift", "Y"], global: true },
    ],
  },
];

const Keycap = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-border-neutral-faded bg-background-page-secondary px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground-secondary shadow-sm">
    {children}
  </kbd>
);

export function ShortcutsSection() {
  const openBrowserShortcuts = () => {
    try {
      void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <SectionHeading
        title="Shortcuts"
        description="Keyboard shortcuts to move fast. Browser-level shortcuts (marked ⌘) can be customized in your browser."
      />

      {GROUPS.map((group) => (
        <SettingGroup key={group.title} label={group.title}>
          {group.items.map((shortcut) => (
            <div key={shortcut.label} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground-neutral">{shortcut.label}</div>
                {shortcut.description && (
                  <div className="mt-0.5 text-[13px] text-foreground-secondary">{shortcut.description}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key, index) => (
                  <Keycap key={`${shortcut.label}-${index}`}>{key}</Keycap>
                ))}
              </div>
            </div>
          ))}
        </SettingGroup>
      ))}

      <button
        type="button"
        onClick={openBrowserShortcuts}
        className="mt-4 text-[12px] text-foreground-tertiary underline-offset-2 outline-none hover:text-foreground-secondary hover:underline focus-visible:text-foreground-secondary"
      >
        Customize browser shortcuts →
      </button>
    </div>
  );
}
