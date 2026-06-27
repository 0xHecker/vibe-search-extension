import { useSyncExternalStore } from "react";
import { parseQueryMode } from "@src/search-core/contracts";
import type { QueryMode, QueryScope } from "@src/search-core/contracts";

/**
 * User-tunable search defaults, persisted to localStorage and shared reactively
 * across the search bar chips and the Settings → Search section.
 *
 * Resolution order at query time is: typed directive → session override →
 * these saved defaults (see Search.tsx). These functions only own the last,
 * "saved default" layer.
 */

const MODE_KEY = "vibesearch:defaultSearchMode";
const SCOPE_KEY = "vibesearch:defaultSearchScope";

/** Hybrid (keyword + semantic) — a strong default for most libraries. */
export const DEFAULT_SEARCH_MODE: QueryMode = "keyword+vector";
/** Everywhere — search isn't walled to the space you happen to be browsing. */
export const DEFAULT_SEARCH_SCOPE: QueryScope = "global";

const VALID_SCOPES: readonly QueryScope[] = ["current", "global", "private", "public"];

const parseScope = (raw: string | null): QueryScope | null =>
  raw && (VALID_SCOPES as readonly string[]).includes(raw) ? (raw as QueryScope) : null;

const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export const getDefaultSearchMode = (): QueryMode => {
  try {
    return parseQueryMode(localStorage.getItem(MODE_KEY) ?? "") ?? DEFAULT_SEARCH_MODE;
  } catch {
    return DEFAULT_SEARCH_MODE;
  }
};

export const setDefaultSearchMode = (mode: QueryMode): void => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  emit();
};

export const getDefaultSearchScope = (): QueryScope => {
  try {
    return parseScope(localStorage.getItem(SCOPE_KEY)) ?? DEFAULT_SEARCH_SCOPE;
  } catch {
    return DEFAULT_SEARCH_SCOPE;
  }
};

export const setDefaultSearchScope = (scope: QueryScope): void => {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* ignore */
  }
  emit();
};

/** Subscribe to in-tab `set*` calls and cross-tab `storage` events. */
const subscribe = (callback: () => void): (() => void) => {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODE_KEY || event.key === SCOPE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
};

export const useDefaultSearchMode = (): QueryMode =>
  useSyncExternalStore(subscribe, getDefaultSearchMode, () => DEFAULT_SEARCH_MODE);

export const useDefaultSearchScope = (): QueryScope =>
  useSyncExternalStore(subscribe, getDefaultSearchScope, () => DEFAULT_SEARCH_SCOPE);
