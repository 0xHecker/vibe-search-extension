import type { CSSProperties } from "react";

/** 4×4 tag color palette, shared by the Tags manager and tag editors. */
export const TAG_COLORS = [
  "#6b7280", "#64748b", "#ef4444", "#f97316",
  "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
];

const DEFAULT_DOT = "#cbd5e1";

/** Subtle tinted background + border for a colored tag chip. */
export const tagChipStyle = (color?: string | null): CSSProperties =>
  color ? { backgroundColor: `${color}1f`, borderColor: `${color}40` } : {};

/** Solid swatch for the tag's color dot. */
export const tagDotStyle = (color?: string | null): CSSProperties => ({
  backgroundColor: color || DEFAULT_DOT,
});
