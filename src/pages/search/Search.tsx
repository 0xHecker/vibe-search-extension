import { cn } from "@src/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "@src/components/icons/tabs";
import SidePanel from "@src/components/ui/SidePanel";
import { TabGroups } from "@src/components/TabGroups/TabGroups";
import { ChevronRight } from "@src/components/icons/chevron-right";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";
import { SpaceDocType } from "@src/schemas/space_schema";
import {
  SearchQueryBar,
  type SearchQuerySubmitMeta,
} from "@src/pages/search/components/SearchQueryBar";
import {
  SearchProcessStatus,
  SearchProcessStatusItem,
  SearchProcessRetryAction,
} from "@src/pages/search/components/SearchProcessStatus";
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
import { analyzeQuery } from "@src/search-core/query-language";
import { getQueryModeFeatures } from "@src/search-core/contracts";
import type {
  QueryDebugPayload,
  QueryRankDebugScore,
  QueryAnalysis,
  QueryAssistCatalogs,
  QueryMode,
  QuerySortBy,
  QuerySortOrder,
  RankQueryCursor,
} from "@src/search-core/contracts";
import { Lock, Plus, Shield, Globe2 } from "lucide-react";
import { Toaster } from "sonner";
import {
  PRIVATE_PASSWORD_MIN_LENGTH,
  PRIVATE_SPACE_ID,
  PUBLIC_SPACE_ID,
} from "@src/common/spaces";
import {
  resolveToastErrorMessage,
  showErrorToast,
  showLoadingToast,
  showSuccessToast,
} from "@src/utils/toast-feedback";

const SOURCE_OPTIONS: ItemDocType["source"][] = [
  "web",
  "twitter",
  "reddit",
  "note",
  "youtube",
  "instagram",
  "tiktok",
  "substack",
  "linkedin",
  "github",
  "article",
];

const RECENT_QUERIES_KEY = "vibe-search-recent-queries";
const MAX_VECTOR_TOPK = 4000;
const SCORE_BUDGET_MULTIPLIER = 8;
const MIN_SCORE_BUDGET = 600;
const QUERY_REFRESH_DEBOUNCE_IDLE_MS = 150;
const QUERY_REFRESH_DEBOUNCE_PROCESSING_MS = 500;
const QUERY_REFRESH_DEBOUNCE_LOW_PRIORITY_MS = 750;
const SPACE_ACTIVITY_TOUCH_THROTTLE_MS = 12_000;
const SPACE_ACCESS_POLL_MS = 20_000;
const PROCESS_STATUS_MAX_ENTRIES = 80;
const PROCESS_STATUS_SUCCESS_TTL_MS = 15 * 60 * 1000;
const QUERY_REQUEST_TIMEOUT_MS = 20_000;
const VECTOR_QUERY_MIN_CHARS = 3;
const SEARCH_DEBUG_STORAGE_KEY = "vibe.search.debug";
const SEARCH_DEBUG_QUERY_PARAM = "debugSearch";

type SpaceListItem = Pick<
  SpaceDocType,
  "id" | "name" | "slug" | "isPrivate" | "sortOrder" | "isArchived" | "createdAt" | "updatedAt"
> & {
  access: {
    isUnlocked: boolean;
    requiresPassword: boolean;
    hasRecovery: boolean;
    recoveryQuestions: string[];
    autoLockMs: number;
    remainingMs?: number;
    lastActivityAt?: number;
  };
};

type SearchQueryDiagnostics = {
  queryHash: string;
  candidateCount: number;
  rankInputCount: number;
  usedSimpleSortPath: boolean;
  scoreBudget: number;
  supersededCount: number;
  fallbackCount: number;
  selectorMs: number;
  filterMs: number;
  lexicalMs: number;
  vectorMs: number;
  vectorEmbedMs: number;
  vectorScanMs: number;
  rankMs: number;
  hydrateMs: number;
  totalMs: number;
};

type SearchQueryPayload = {
  items: ItemDocType[];
  total: number;
  vectorHits: number;
  lexicalHits: number;
  vectorError?: string | null;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: RankQueryCursor | null;
  diagnostics?: SearchQueryDiagnostics;
  debug?: QueryDebugPayload;
};

const defaultAnalysis: QueryAnalysis = {
  requestId: 0,
  input: "",
  freeText: "",
  textGroups: [],
  excludedTerms: [],
  textExpression: undefined,
  tokens: [],
  pills: [],
  filters: {
    spaceIds: [],
    excludeSpaceIds: [],
    sources: [],
    excludeSources: [],
    folderIds: [],
    excludeFolderIds: [],
    tagNames: [],
    excludeTagNames: [],
    domains: [],
    excludeDomains: [],
    authors: [],
    excludeAuthors: [],
    hasAny: [],
    excludeHasAny: [],
    favoritesOnly: false,
  },
  directives: {},
  activeTokenStart: 0,
  activeTokenEnd: 0,
  activeTokenText: "",
  shouldOpenSuggestions: false,
  suggestions: [],
};

const sortFolders = (list: FolderDocType[]) =>
  [...list].sort((a, b) => {
    if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.createdAt - b.createdAt;
  });

const sortSpaces = (list: SpaceListItem[]) =>
  [...list].sort((a, b) => {
    if (!!a.isPrivate !== !!b.isPrivate) return a.isPrivate ? 1 : -1;
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.createdAt - b.createdAt;
  });

const parseDomain = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const unique = <T,>(list: T[]) => Array.from(new Set(list));
const sameStringArray = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const Search = () => {
  const [theme] = useState("light");
  const [isOpen, setIsOpen] = useState(true);
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>(PUBLIC_SPACE_ID);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockConfirmPassword, setUnlockConfirmPassword] = useState("");
  const [unlockQuestion1, setUnlockQuestion1] = useState("");
  const [unlockQuestion2, setUnlockQuestion2] = useState("");
  const [unlockAnswer1, setUnlockAnswer1] = useState("");
  const [unlockAnswer2, setUnlockAnswer2] = useState("");
  const [unlockDialogError, setUnlockDialogError] = useState<string | null>(null);
  const [unlockDialogLoading, setUnlockDialogLoading] = useState(false);
  const [unlockDialogMode, setUnlockDialogMode] = useState<"unlock" | "setup" | "recovery">("unlock");
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
  const [changePasswordCurrent, setChangePasswordCurrent] = useState("");
  const [changePasswordNext, setChangePasswordNext] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [createSpaceDialogOpen, setCreateSpaceDialogOpen] = useState(false);
  const [createSpaceName, setCreateSpaceName] = useState("");
  const [createSpaceError, setCreateSpaceError] = useState<string | null>(null);
  const [createSpaceLoading, setCreateSpaceLoading] = useState(false);
  const [folders, setFolders] = useState<FolderDocType[]>([]);
  const [items, setItems] = useState<ItemDocType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const isDevBuild = (import.meta as any)?.env?.DEV === true;
  const [isDebugSearchEnabled, setIsDebugSearchEnabled] = useState(() => {
    if (!isDevBuild) return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get(SEARCH_DEBUG_QUERY_PARAM) === "1";
      const fromStorage = localStorage.getItem(SEARCH_DEBUG_STORAGE_KEY) === "1";
      return fromQuery || fromStorage;
    } catch {
      return false;
    }
  });

  const [queryText, setQueryText] = useState("");
  const [queryAnalysis, setQueryAnalysis] = useState<QueryAnalysis>(defaultAnalysis);
  const [querySubmitMeta, setQuerySubmitMeta] = useState<SearchQuerySubmitMeta | null>(null);
  const [resultDebug, setResultDebug] = useState<QueryDebugPayload | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("all");
  const [resultMeta, setResultMeta] = useState<{
    total: number;
    vectorHits: number;
    lexicalHits: number;
    vectorError?: string | null;
    page: number;
    limit: number;
    hasMore: boolean;
    nextCursor?: RankQueryCursor | null;
    mode: QueryMode;
  }>({
    total: 0,
    vectorHits: 0,
    lexicalHits: 0,
    vectorError: null,
    page: 1,
    limit: 100,
    hasMore: false,
    nextCursor: null,
    mode: "keyword",
  });

  const [tagsCatalog, setTagsCatalog] = useState<Array<{ id: string; name: string }>>([]);
  const [domainsCatalog, setDomainsCatalog] = useState<string[]>([]);
  const [authorsCatalog, setAuthorsCatalog] = useState<string[]>([]);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [processStatusById, setProcessStatusById] = useState<
    Record<string, SearchProcessStatusItem>
  >({});
  const [retryingProcessId, setRetryingProcessId] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const tagReloadTimerRef = useRef<number | null>(null);
  const activityTouchRef = useRef<number>(0);
  const accessPollTimerRef = useRef<number | null>(null);
  const previousActiveSpaceRef = useRef<string>(PUBLIC_SPACE_ID);
  const visibleItemIdsRef = useRef<Set<string>>(new Set());
  const hasConstrainedQueryRef = useRef(false);
  const staleSuppressedCountRef = useRef(0);
  const [staleSuppressedCount, setStaleSuppressedCount] = useState(0);
  const [cursorAfter, setCursorAfter] = useState<RankQueryCursor | null>(null);
  const [cursorPage, setCursorPage] = useState(1);
  const [cursorHistory, setCursorHistory] = useState<Array<RankQueryCursor | null>>([]);

  const processStatuses = useMemo(
    () => Object.values(processStatusById).sort((a, b) => b.updatedAt - a.updatedAt),
    [processStatusById]
  );
  const debugScoresByItemId = useMemo<Record<string, QueryRankDebugScore>>(() => {
    if (!resultDebug) return {};
    return Object.fromEntries(resultDebug.perItem.map((entry) => [entry.itemId, entry]));
  }, [resultDebug]);
  const topDebugVectorHit = useMemo(
    () => (resultDebug?.vectorTopHits && resultDebug.vectorTopHits.length > 0
      ? resultDebug.vectorTopHits[0]
      : null),
    [resultDebug]
  );
  const hasBackgroundProcessing = useMemo(
    () => processStatuses.some((status) => status.state === "processing" && status.id !== "search-query"),
    [processStatuses]
  );

  const upsertProcessStatus = useCallback((status: SearchProcessStatusItem) => {
    setProcessStatusById((prev) => {
      const next = {
        ...prev,
        [status.id]: status,
      };
      const now = Date.now();
      const entries = Object.values(next)
        .filter(
          (row) => row.state !== "success" || now - row.updatedAt <= PROCESS_STATUS_SUCCESS_TTL_MS
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, PROCESS_STATUS_MAX_ENTRIES);
      return Object.fromEntries(entries.map((row) => [row.id, row]));
    });
  }, []);

  const clearProcessStatus = useCallback((statusId: string) => {
    setProcessStatusById((prev) => {
      if (!(statusId in prev)) return prev;
      const next = { ...prev };
      delete next[statusId];
      return next;
    });
  }, []);

  const activeSpace = useMemo(
    () => spaces.find((space) => space.id === activeSpaceId) || null,
    [activeSpaceId, spaces]
  );
  const privateSpace = useMemo(
    () => spaces.find((space) => space.id === PRIVATE_SPACE_ID) || null,
    [spaces]
  );
  const isPrivateSpaceActive = activeSpace?.id === PRIVATE_SPACE_ID;
  const isPrivateUnlocked = privateSpace?.access.isUnlocked === true;
  const activeSpaceFolders = useMemo(
    () => folders.filter((folder) => folder.spaceId === activeSpaceId),
    [activeSpaceId, folders]
  );

  const catalogs = useMemo<QueryAssistCatalogs>(
    () => ({
      sources: SOURCE_OPTIONS,
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        isPrivate: space.isPrivate,
      })),
      folders: activeSpaceFolders.map((folder) => ({ id: folder.id, name: folder.name })),
      tags: tagsCatalog,
      domains: domainsCatalog,
      authors: authorsCatalog,
      recentQueries,
    }),
    [activeSpaceFolders, authorsCatalog, domainsCatalog, recentQueries, spaces, tagsCatalog]
  );

  const visibleFolderIdsFromResults = useMemo(
    () => new Set(items.map((item) => item.folderId)),
    [items]
  );
  const isAnalysisCurrent = queryAnalysis.input === queryText;
  const requestedScope = isAnalysisCurrent
    ? queryAnalysis.directives.scope || "current"
    : "current";
  const requestedScopeLabel = useMemo(() => {
    if (requestedScope === "global") return "All spaces";
    if (requestedScope === "private") return "Private only";
    if (requestedScope === "public") return "Public only";
    return activeSpace?.name || "Current space";
  }, [activeSpace?.name, requestedScope]);

  const visibleFolders = useMemo(() => {
    const shouldUseResultDrivenFolders =
      selectedFolderId === "all" && requestedScope !== "current";
    const sourceFolders = shouldUseResultDrivenFolders
      ? folders.filter((folder) => visibleFolderIdsFromResults.has(folder.id))
      : activeSpaceFolders;

    if (selectedFolderId === "all") return sourceFolders;
    return sourceFolders.filter((folder) => folder.id === selectedFolderId);
  }, [
    activeSpaceFolders,
    folders,
    requestedScope,
    selectedFolderId,
    visibleFolderIdsFromResults,
  ]);

  const preserveInputOrder = useMemo(() => {
    if (!isAnalysisCurrent) return false;
    return queryAnalysis.textGroups.length > 0 || !!queryAnalysis.directives.sortBy;
  }, [isAnalysisCurrent, queryAnalysis.directives.sortBy, queryAnalysis.textGroups.length]);

  useEffect(() => {
    if (selectedFolderId === "all") return;
    if (!activeSpaceFolders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId("all");
    }
  }, [activeSpaceFolders, selectedFolderId]);

  useEffect(() => {
    setCursorAfter(null);
    setCursorPage(1);
    setCursorHistory([]);
  }, [queryText, selectedFolderId, activeSpaceId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_QUERIES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        setRecentQueries(parsed.filter(Boolean).slice(0, 20));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isDevBuild) return;
    try {
      localStorage.setItem(SEARCH_DEBUG_STORAGE_KEY, isDebugSearchEnabled ? "1" : "0");
    } catch {}
  }, [isDebugSearchEnabled, isDevBuild]);

  useEffect(() => {
    if (isDebugSearchEnabled) return;
    setResultDebug(null);
  }, [isDebugSearchEnabled]);

  const loadSpaces = useCallback(async (): Promise<SpaceListItem[]> => {
    try {
      const response = await chrome.runtime.sendMessage({
        service: "spaces",
        type: "listSpaces",
        target: "offscreen",
      });
      if (!response?.success) return [];
      const rows = sortSpaces((response.payload as SpaceListItem[]) || []);
      setSpaces(rows);
      if (rows.length === 0) return [];
      setActiveSpaceId((current) =>
        rows.some((space) => space.id === current) ? current : PUBLIC_SPACE_ID
      );
      return rows;
    } catch (loadError) {
      console.error("Failed to load spaces:", loadError);
      return [];
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const foldersResponse = await chrome.runtime.sendMessage({
        service: "dbManager",
        type: "getAllFolders",
        target: "offscreen",
        payload: {
          accessContext: {
            activeSpaceId,
            searchScope: requestedScope,
          },
        },
      });

      if (foldersResponse?.success) {
        const next = sortFolders((foldersResponse.payload as FolderDocType[]) || []).map((folder) => ({
          ...folder,
          spaceId: folder.spaceId || PUBLIC_SPACE_ID,
        }));
        setFolders(next);
      }
    } catch (loadError) {
      console.error("Failed to load folders:", loadError);
    }
  }, [activeSpaceId, requestedScope]);

  const loadTags = useCallback(async () => {
    try {
      const tagsResponse = await chrome.runtime.sendMessage({
        service: "tags",
        type: "searchTags",
        target: "offscreen",
        payload: {
          query: "",
          limit: 200,
          accessContext: {
            activeSpaceId,
            searchScope: requestedScope,
          },
        },
      });

      if (tagsResponse?.success) {
        const rows = (tagsResponse.payload as Array<{ id: string; name: string }>) || [];
        setTagsCatalog(rows.map((row) => ({ id: row.id, name: row.name })));
      }
    } catch (loadError) {
      console.error("Failed to load tags:", loadError);
    }
  }, [activeSpaceId, requestedScope]);

  const scheduleTagReload = useCallback(() => {
    if (tagReloadTimerRef.current !== null) {
      window.clearTimeout(tagReloadTimerRef.current);
    }
    tagReloadTimerRef.current = window.setTimeout(() => {
      tagReloadTimerRef.current = null;
      loadTags();
    }, 150);
  }, [loadTags]);

  const lockPrivateSpace = useCallback(
    async (detail: string) => {
      let locked = false;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await chrome.runtime.sendMessage({
            service: "spaces",
            type: "lockSpace",
            target: "offscreen",
            payload: { spaceId: PRIVATE_SPACE_ID },
          });
          locked = true;
          break;
        } catch (lockError) {
          lastError = lockError;
          await new Promise((resolve) => {
            window.setTimeout(resolve, 120 * (attempt + 1));
          });
        }
      }

      if (!locked && lastError) {
        console.error("Failed to lock private space:", lastError);
      }

      try {
        await loadSpaces();
      } catch {}

      upsertProcessStatus({
        id: "private-space",
        label: "Private space",
        state: locked ? "success" : "error",
        detail: locked ? detail : "Could not lock private space immediately. It will auto-lock on timeout.",
        retryAction: locked ? undefined : "LOCK_PRIVATE_SPACE",
        updatedAt: Date.now(),
      });
    },
    [loadSpaces, upsertProcessStatus]
  );

  const resetUnlockDialogState = useCallback(() => {
    setUnlockPassword("");
    setUnlockConfirmPassword("");
    setUnlockQuestion1("");
    setUnlockQuestion2("");
    setUnlockAnswer1("");
    setUnlockAnswer2("");
    setUnlockDialogError(null);
    setUnlockDialogLoading(false);
  }, []);

  const handleSelectSpace = useCallback(
    async (space: SpaceListItem) => {
      if (space.isPrivate && !space.access.isUnlocked) {
        setUnlockDialogMode(space.access.requiresPassword ? "setup" : "unlock");
        resetUnlockDialogState();
        setUnlockDialogOpen(true);
        return;
      }

      setActiveSpaceId(space.id);
      setSelectedFolderId("all");
    },
    [resetUnlockDialogState]
  );

  const submitPrivateAccess = useCallback(async () => {
    setUnlockDialogError(null);
    setUnlockDialogLoading(true);
    const actionLabel =
      unlockDialogMode === "setup"
        ? "Configuring private space..."
        : unlockDialogMode === "recovery"
          ? "Recovering private space..."
          : "Unlocking private space...";
    const toastId = showLoadingToast(actionLabel);
    try {
      if (unlockDialogMode === "setup") {
        if (unlockPassword.length < PRIVATE_PASSWORD_MIN_LENGTH) {
          throw new Error(`Use at least ${PRIVATE_PASSWORD_MIN_LENGTH} characters.`);
        }
        if (unlockPassword !== unlockConfirmPassword) {
          throw new Error("Passwords do not match.");
        }
        if (unlockQuestion1.trim().length < 4 || unlockQuestion2.trim().length < 4) {
          throw new Error("Add two clear recovery questions.");
        }
        if (unlockAnswer1.trim().length < 2 || unlockAnswer2.trim().length < 2) {
          throw new Error("Add answers for both recovery questions.");
        }
        const questions = [
          { question: unlockQuestion1, answer: unlockAnswer1 },
          { question: unlockQuestion2, answer: unlockAnswer2 },
        ];
        const response = await chrome.runtime.sendMessage({
          service: "spaces",
          type: "setPrivatePassword",
          target: "offscreen",
          payload: {
            spaceId: PRIVATE_SPACE_ID,
            password: unlockPassword,
            recoveryQuestions: questions,
          },
        });
        if (!response?.success) {
          throw new Error(response?.error || "Failed to configure private space password.");
        }
      } else if (unlockDialogMode === "recovery") {
        if (unlockPassword.length < PRIVATE_PASSWORD_MIN_LENGTH) {
          throw new Error(`Use at least ${PRIVATE_PASSWORD_MIN_LENGTH} characters.`);
        }
        if (unlockPassword !== unlockConfirmPassword) {
          throw new Error("Passwords do not match.");
        }
        if (!unlockAnswer1.trim() || !unlockAnswer2.trim()) {
          throw new Error("Answer both recovery questions.");
        }
        const response = await chrome.runtime.sendMessage({
          service: "spaces",
          type: "recoverPrivatePassword",
          target: "offscreen",
          payload: {
            spaceId: PRIVATE_SPACE_ID,
            answer1: unlockAnswer1,
            answer2: unlockAnswer2,
            newPassword: unlockPassword,
          },
        });
        if (!response?.success) {
          throw new Error(response?.error || "Recovery failed.");
        }
      } else {
        const response = await chrome.runtime.sendMessage({
          service: "spaces",
          type: "unlockSpace",
          target: "offscreen",
          payload: { spaceId: PRIVATE_SPACE_ID, password: unlockPassword },
        });
        if (!response?.success) {
          throw new Error(response?.error || "Failed to unlock private space.");
        }
      }

      await loadSpaces();
      setActiveSpaceId(PRIVATE_SPACE_ID);
      setSelectedFolderId("all");
      setUnlockDialogOpen(false);
      resetUnlockDialogState();
      upsertProcessStatus({
        id: "private-space",
        label: "Private space",
        state: "success",
        detail:
          unlockDialogMode === "setup"
            ? "Private space is configured and unlocked."
            : unlockDialogMode === "recovery"
              ? "Private space recovered and unlocked."
            : "Private space unlocked.",
        updatedAt: Date.now(),
      });
      showSuccessToast("Private space ready.", { id: toastId });
    } catch (unlockError) {
      const message = unlockError instanceof Error ? unlockError.message : "Unable to unlock private space.";
      setUnlockDialogError(message);
      upsertProcessStatus({
        id: "private-space",
        label: "Private space",
        state: "error",
        detail: message,
        updatedAt: Date.now(),
      });
      showErrorToast(message, { id: toastId });
    } finally {
      setUnlockDialogLoading(false);
    }
  }, [
    loadSpaces,
    resetUnlockDialogState,
    unlockDialogMode,
    unlockQuestion1,
    unlockQuestion2,
    unlockAnswer1,
    unlockAnswer2,
    unlockPassword,
    unlockConfirmPassword,
    upsertProcessStatus,
  ]);

  const submitPasswordChange = useCallback(async () => {
    if (changePasswordNext.length < PRIVATE_PASSWORD_MIN_LENGTH) {
      setChangePasswordError(`Use at least ${PRIVATE_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (changePasswordNext !== changePasswordConfirm) {
      setChangePasswordError("Passwords do not match.");
      return;
    }

    setChangePasswordError(null);
    setChangePasswordLoading(true);
    const toastId = showLoadingToast("Updating private password...");
    try {
      const response = await chrome.runtime.sendMessage({
        service: "spaces",
        type: "changePrivatePassword",
        target: "offscreen",
        payload: {
          spaceId: PRIVATE_SPACE_ID,
          currentPassword: changePasswordCurrent,
          newPassword: changePasswordNext,
        },
      });
      if (!response?.success) {
        throw new Error(response?.error || "Failed to change password.");
      }

      await loadSpaces();
      setChangePasswordDialogOpen(false);
      setChangePasswordCurrent("");
      setChangePasswordNext("");
      setChangePasswordConfirm("");
      upsertProcessStatus({
        id: "private-space",
        label: "Private space",
        state: "success",
        detail: "Private space password updated.",
        updatedAt: Date.now(),
      });
      showSuccessToast("Private password updated.", { id: toastId });
    } catch (changeError) {
      const message =
        changeError instanceof Error ? changeError.message : "Failed to change private password.";
      setChangePasswordError(message);
      showErrorToast(message, { id: toastId });
    } finally {
      setChangePasswordLoading(false);
    }
  }, [changePasswordConfirm, changePasswordCurrent, changePasswordNext, loadSpaces, upsertProcessStatus]);

  const submitCreateSpace = useCallback(async () => {
    const name = createSpaceName.trim();
    if (!name) {
      setCreateSpaceError("Space name is required.");
      return;
    }

    setCreateSpaceError(null);
    setCreateSpaceLoading(true);
    const toastId = showLoadingToast("Creating space...");
    try {
      const response = await chrome.runtime.sendMessage({
        service: "spaces",
        type: "createSpace",
        target: "offscreen",
        payload: { name },
      });
      if (!response?.success) {
        throw new Error(response?.error || "Failed to create space.");
      }
      const created = response.payload as SpaceListItem;
      await loadSpaces();
      setActiveSpaceId(created.id);
      setSelectedFolderId("all");
      setCreateSpaceName("");
      setCreateSpaceDialogOpen(false);
      showSuccessToast(`Space "${created.name}" created.`, { id: toastId });
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to create space.";
      setCreateSpaceError(message);
      showErrorToast(message, { id: toastId });
    } finally {
      setCreateSpaceLoading(false);
    }
  }, [createSpaceName, loadSpaces]);

  const touchPrivateSpaceActivity = useCallback(async () => {
    if (activeSpaceId !== PRIVATE_SPACE_ID || !isPrivateUnlocked) {
      return;
    }
    const now = Date.now();
    if (now - activityTouchRef.current < SPACE_ACTIVITY_TOUCH_THROTTLE_MS) {
      return;
    }
    activityTouchRef.current = now;
    try {
      await chrome.runtime.sendMessage({
        service: "spaces",
        type: "touchSpaceActivity",
        target: "offscreen",
        payload: { spaceId: PRIVATE_SPACE_ID },
      });
    } catch (touchError) {
      console.error("Failed to touch private space session:", touchError);
    }
  }, [activeSpaceId, isPrivateUnlocked]);

  useEffect(() => {
    if (activeSpaceId !== PRIVATE_SPACE_ID || !isPrivateUnlocked) {
      return;
    }
    const onActivity = () => {
      void touchPrivateSpaceActivity();
    };
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "wheel",
      "scroll",
      "focus",
    ];
    for (const eventName of events) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, onActivity);
      }
    };
  }, [activeSpaceId, isPrivateUnlocked, touchPrivateSpaceActivity]);

  useEffect(() => {
    const pollAccess = async () => {
      const rows = await loadSpaces();
      const privateRow = rows.find((space) => space.id === PRIVATE_SPACE_ID);
      if (activeSpaceId === PRIVATE_SPACE_ID && privateRow && !privateRow.access.isUnlocked) {
        setActiveSpaceId(PUBLIC_SPACE_ID);
        setSelectedFolderId("all");
        upsertProcessStatus({
          id: "private-space",
          label: "Private space",
          state: "success",
          detail: "Private space auto-locked after inactivity.",
          updatedAt: Date.now(),
        });
      }
    };

    void pollAccess();
    accessPollTimerRef.current = window.setInterval(() => {
      void pollAccess();
    }, SPACE_ACCESS_POLL_MS);

    return () => {
      if (accessPollTimerRef.current !== null) {
        window.clearInterval(accessPollTimerRef.current);
        accessPollTimerRef.current = null;
      }
    };
  }, [activeSpaceId, loadSpaces, upsertProcessStatus]);

  const scheduleQueryRefresh = useCallback(
    (priority: "high" | "low" = "high") => {
      const delay =
        priority === "low"
          ? QUERY_REFRESH_DEBOUNCE_LOW_PRIORITY_MS
          : hasBackgroundProcessing
            ? QUERY_REFRESH_DEBOUNCE_PROCESSING_MS
            : QUERY_REFRESH_DEBOUNCE_IDLE_MS;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        setRefreshToken((value) => value + 1);
      }, delay);
    },
    [hasBackgroundProcessing]
  );

  useEffect(() => {
    const previous = previousActiveSpaceRef.current;
    previousActiveSpaceRef.current = activeSpaceId;
    if (previous !== PRIVATE_SPACE_ID || activeSpaceId === PRIVATE_SPACE_ID || !isPrivateUnlocked) {
      return;
    }
    void lockPrivateSpace("Private space locked when you left it.");
  }, [activeSpaceId, isPrivateUnlocked, lockPrivateSpace]);

  useEffect(() => {
    visibleItemIdsRef.current = new Set(items.map((item) => item.id));
  }, [items]);

  useEffect(() => {
    const queryTextHasValue = queryText.trim().length > 0;
    const hasConstrainedQuery =
      queryTextHasValue ||
      (isAnalysisCurrent &&
        (queryAnalysis.freeText.trim().length > 0 ||
          queryAnalysis.pills.length > 0 ||
          queryAnalysis.textGroups.length > 0 ||
          queryAnalysis.excludedTerms.length > 0));
    hasConstrainedQueryRef.current = hasConstrainedQuery;
  }, [
    isAnalysisCurrent,
    queryText,
    queryAnalysis.excludedTerms.length,
    queryAnalysis.freeText,
    queryAnalysis.pills.length,
    queryAnalysis.textGroups.length,
  ]);

  const persistRecentQuery = (query: string) => {
    const clean = query.trim();
    if (!clean) return;
    setRecentQueries((prev) => {
      const next = [clean, ...prev.filter((row) => row !== clean)].slice(0, 20);
      if (sameStringArray(prev, next)) {
        return prev;
      }
      try {
        localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleSubmitQuery = useCallback(
    (nextQuery: string, analysis: QueryAnalysis, meta: SearchQuerySubmitMeta) => {
      setQueryText(nextQuery);
      setQueryAnalysis(analysis);
      setQuerySubmitMeta(meta);
      setCursorAfter(null);
      setCursorPage(1);
      setCursorHistory([]);
      setRefreshToken((value) => value + 1);
    },
    []
  );

  const triggerRetryAction = useCallback(
    async (status: SearchProcessStatusItem) => {
      const action = status.retryAction as SearchProcessRetryAction | undefined;
      if (!action) return;
      const retryToastId = showLoadingToast(`Retrying ${status.label.toLowerCase()}...`, "quick");

      setRetryingProcessId(status.id);
      upsertProcessStatus({
        ...status,
        state: "processing",
        detail: "Retry requested...",
        updatedAt: Date.now(),
      });

      try {
        if (action === "RETRY_QUERY") {
          setRefreshToken((value) => value + 1);
          showSuccessToast("Retrying query...", { id: retryToastId, tempo: "quick" });
          return;
        }

        if (action === "TRIGGER_EMBEDDING") {
          await chrome.runtime.sendMessage({
            type: "TRIGGER_EMBEDDING",
            target: "offscreen",
          });
          showSuccessToast("Embedding refresh queued.", { id: retryToastId, tempo: "quick" });
          return;
        }

        if (action === "REBUILD_INDEX") {
          await chrome.runtime.sendMessage({
            service: "items",
            type: "markSearchIndexDirty",
            target: "offscreen",
          });
          setRefreshToken((value) => value + 1);
          showSuccessToast("Search index rebuild queued.", { id: retryToastId, tempo: "quick" });
          return;
        }

        if (action === "REBUILD_VECTORS") {
          await chrome.runtime.sendMessage({
            service: "sync",
            type: "rebuildAndCompact",
            target: "offscreen",
          });
          showSuccessToast("Vector rebuild started.", { id: retryToastId, tempo: "quick" });
          return;
        }

        if (action === "LOCK_PRIVATE_SPACE") {
          await lockPrivateSpace("Private space locked.");
          showSuccessToast("Private space lock requested.", { id: retryToastId, tempo: "quick" });
          return;
        }

        if (action === "RETRY_IMPORT") {
          const retryResponse = await chrome.runtime.sendMessage({
            target: "background",
            type: "IMPORT_RETRY_FAILED",
            payload: { statusId: status.id },
          });
          if (!retryResponse?.success) {
            throw new Error(retryResponse?.error || "Import retry failed.");
          }
          clearProcessStatus(status.id);
          showSuccessToast("Import retry queued.", { id: retryToastId, tempo: "quick" });
        }
      } catch (retryError) {
        const retryMessage = resolveToastErrorMessage(retryError, "Retry request failed.");
        upsertProcessStatus({
          ...status,
          state: "error",
          detail: retryMessage,
          updatedAt: Date.now(),
        });
        showErrorToast(retryMessage, { id: retryToastId });
      } finally {
        setRetryingProcessId(null);
      }
    },
    [clearProcessStatus, lockPrivateSpace, upsertProcessStatus]
  );

  const resolveFolderFilterValues = (values: string[]): string[] => {
    if (values.length === 0) return [];
    const byName = new Map(folders.map((folder) => [folder.name.toLowerCase(), folder.id]));
    return unique(
      values
        .map((value) => {
          if (folders.some((folder) => folder.id === value)) return value;
          return byName.get(value.toLowerCase()) || null;
        })
        .filter((value): value is string => !!value)
    );
  };

  const resolveSpaceFilterValues = (values: string[]): string[] => {
    if (values.length === 0) return [];
    const byName = new Map(spaces.map((space) => [space.name.toLowerCase(), space.id]));
    return unique(
      values
        .map((value) => {
          if (spaces.some((space) => space.id === value)) return value;
          return byName.get(value.toLowerCase()) || null;
        })
        .filter((value): value is string => !!value)
    );
  };

  const sendMessageWithTimeout = useCallback(
    async <T,>(message: unknown, timeoutMs: number): Promise<T> => {
      let timeoutId: number | null = null;
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`Search request timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      });

      try {
        return await Promise.race([
          chrome.runtime.sendMessage(message) as Promise<T>,
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      }
    },
    []
  );

  const executeQuery = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const requestStartedAt = performance.now();
    const analysisCurrent = queryAnalysis.input === queryText;
    const effectiveDirectives = analysisCurrent ? queryAnalysis.directives : {};
    const effectiveFilters = analysisCurrent ? queryAnalysis.filters : defaultAnalysis.filters;
    const freeText = analysisCurrent ? queryAnalysis.freeText.trim() : queryText.trim();
    const mode = effectiveDirectives.mode ?? "keyword";
    const modeFeatures = getQueryModeFeatures(mode);
    const useLexicalSearch = modeFeatures.keyword || modeFeatures.fuzzy;
    const canUseVector = modeFeatures.vector && freeText.length >= VECTOR_QUERY_MIN_CHARS;
    const useCursorPagination = effectiveDirectives.page === undefined;
    const page = useCursorPagination ? cursorPage : effectiveDirectives.page ?? 1;
    const limit = effectiveDirectives.limit ?? 100;

    const parsedFolderIds = resolveFolderFilterValues(effectiveFilters.folderIds);
    const parsedExcludeFolderIds = resolveFolderFilterValues(effectiveFilters.excludeFolderIds);
    const parsedSpaceIds = resolveSpaceFilterValues(effectiveFilters.spaceIds);
    const parsedExcludeSpaceIds = resolveSpaceFilterValues(effectiveFilters.excludeSpaceIds);

    const includeFolderIds =
      selectedFolderId === "all" ? parsedFolderIds : unique([...parsedFolderIds, selectedFolderId]);

    const sortBy: QuerySortBy =
      effectiveDirectives.sortBy || (freeText.length > 0 ? "relevance" : "createdAt");
    const sortOrder: QuerySortOrder = effectiveDirectives.sortOrder || "desc";

    setIsLoading(true);
    setError(null);
    upsertProcessStatus({
      id: "search-query",
      label: "Search query",
      state: "processing",
      detail: `Searching local data... mode:${mode}`,
      updatedAt: Date.now(),
    });

    try {
      const response = await sendMessageWithTimeout<any>(
        {
          service: "items",
          type: "queryLocal",
          target: "offscreen",
          payload: {
            query: freeText,
            text: {
              groups: analysisCurrent ? queryAnalysis.textGroups : [],
              excludedTerms: analysisCurrent ? queryAnalysis.excludedTerms : [],
              expression: analysisCurrent ? queryAnalysis.textExpression : undefined,
            },
            useVector: canUseVector,
            useKeyword: useLexicalSearch && modeFeatures.keyword,
            useFuzzy: useLexicalSearch && modeFeatures.fuzzy,
            topK: Math.min(
              MAX_VECTOR_TOPK,
              Math.max(limit * SCORE_BUDGET_MULTIPLIER, MIN_SCORE_BUDGET)
            ),
            pagination: {
              page,
              limit,
              afterCursor: useCursorPagination ? cursorAfter : undefined,
            },
            filters: {
              spaceIds: parsedSpaceIds.length > 0 ? parsedSpaceIds : undefined,
              excludeSpaceIds:
                parsedExcludeSpaceIds.length > 0 ? parsedExcludeSpaceIds : undefined,
              folderIds: includeFolderIds.length > 0 ? includeFolderIds : undefined,
              excludeFolderIds: parsedExcludeFolderIds.length > 0 ? parsedExcludeFolderIds : undefined,
              sources: effectiveFilters.sources.length > 0 ? effectiveFilters.sources : undefined,
              excludeSources:
                effectiveFilters.excludeSources.length > 0 ? effectiveFilters.excludeSources : undefined,
              favoritesOnly: effectiveFilters.favoritesOnly,
              tagNames: effectiveFilters.tagNames,
              excludeTagNames: effectiveFilters.excludeTagNames,
              domains: effectiveFilters.domains,
              excludeDomains: effectiveFilters.excludeDomains,
              authors: effectiveFilters.authors,
              excludeAuthors: effectiveFilters.excludeAuthors,
              hasAny: effectiveFilters.hasAny,
              excludeHasAny: effectiveFilters.excludeHasAny,
              dateFrom: effectiveFilters.dateFrom,
              dateTo: effectiveFilters.dateTo,
              createdFrom: effectiveFilters.createdFrom,
              createdTo: effectiveFilters.createdTo,
              updatedFrom: effectiveFilters.updatedFrom,
              updatedTo: effectiveFilters.updatedTo,
              likesMin: effectiveFilters.likesMin,
              likesMax: effectiveFilters.likesMax,
              upvotesMin: effectiveFilters.upvotesMin,
              upvotesMax: effectiveFilters.upvotesMax,
            },
            sort: {
              by: sortBy,
              order: sortOrder,
            },
            accessContext: {
              activeSpaceId,
              searchScope: requestedScope,
            },
            debug: isDebugSearchEnabled,
          },
        },
        QUERY_REQUEST_TIMEOUT_MS
      );

      if (requestId !== requestIdRef.current) {
        staleSuppressedCountRef.current += 1;
        setStaleSuppressedCount(staleSuppressedCountRef.current);
        return;
      }

      if (!response?.success) {
        throw new Error(response?.error || "Failed to run local query.");
      }

      const payload = response.payload as SearchQueryPayload;

      setItems(payload.items || []);
      setResultDebug(isDebugSearchEnabled ? payload.debug || null : null);
      setResultMeta({
        total: payload.total || 0,
        vectorHits: payload.vectorHits || 0,
        lexicalHits: payload.lexicalHits || 0,
        vectorError: payload.vectorError || null,
        page: payload.page || page,
        limit: payload.limit || limit,
        hasMore: payload.hasMore === true,
        nextCursor: payload.nextCursor || null,
        mode,
      });

      const diagnostics = payload.diagnostics;
      const roundTripMs = Math.max(0, performance.now() - requestStartedAt);
      const bridgeMs = diagnostics
        ? Math.max(0, roundTripMs - diagnostics.totalMs)
        : roundTripMs;
      const uiSubmitWaitMs = Math.max(0, querySubmitMeta?.uiDebounceWaitMs || 0);
      const formatMs = (value: number) => `${Math.max(0, Math.round(value))}ms`;
      const diagnosticsDetail =
        diagnostics && isDebugSearchEnabled
          ? ` • ${diagnostics.candidateCount.toLocaleString()} candidates • ranked ${diagnostics.rankInputCount.toLocaleString()} • budget ${diagnostics.scoreBudget.toLocaleString()} • ${diagnostics.supersededCount} superseded • ${diagnostics.fallbackCount} fallback • stale:${staleSuppressedCountRef.current} • timings: ${formatMs(uiSubmitWaitMs)} submit-wait, ${formatMs(bridgeMs)} bridge, ${formatMs(diagnostics.selectorMs)} selector, ${formatMs(diagnostics.filterMs)} filter, ${formatMs(diagnostics.lexicalMs)} lexical, ${formatMs(diagnostics.vectorEmbedMs)} vector-embed, ${formatMs(diagnostics.vectorScanMs)} vector-scan, ${formatMs(diagnostics.rankMs)} rank, ${formatMs(diagnostics.hydrateMs)} hydrate, ${formatMs(diagnostics.totalMs)} backend, ${formatMs(roundTripMs)} round-trip`
          : "";

      upsertProcessStatus({
        id: "search-query",
        label: "Search query",
        state: "success",
        detail: `Loaded ${(payload.items || []).length} of ${payload.total || 0} results${diagnosticsDetail}.`,
        updatedAt: Date.now(),
      });
      if (payload.vectorError) {
        upsertProcessStatus({
          id: "vector-query",
          label: "Vector query",
          state: "error",
          detail: payload.vectorError,
          retryAction: "RETRY_QUERY",
          updatedAt: Date.now(),
        });
      } else {
        clearProcessStatus("vector-query");
      }

      const nextDomains = unique(
        (payload.items || [])
          .map((item) => parseDomain(item.url || ""))
          .filter((domain): domain is string => !!domain)
      ).slice(0, 120);
      if (nextDomains.length > 0) {
        setDomainsCatalog((prev) => {
          const merged = unique([...nextDomains, ...prev]).slice(0, 240);
          return sameStringArray(prev, merged) ? prev : merged;
        });
      }
      const nextAuthors = unique(
        (payload.items || [])
          .map((item) => (item.authorUsername || "").trim().toLowerCase())
          .filter(Boolean)
      ).slice(0, 180);
      if (nextAuthors.length > 0) {
        setAuthorsCatalog((prev) => {
          const merged = unique([...nextAuthors, ...prev]).slice(0, 280);
          return sameStringArray(prev, merged) ? prev : merged;
        });
      }

      if (isDebugSearchEnabled && diagnostics) {
        console.groupCollapsed(
          `[SearchDebug][${diagnostics.queryHash}] "${freeText || "<empty>"}" (${mode})`
        );
        console.log("scope", requestedScope);
        console.log("counts", {
          total: payload.total || 0,
          shown: (payload.items || []).length,
          vectorHits: payload.vectorHits || 0,
          lexicalHits: payload.lexicalHits || 0,
          staleSuppressed: staleSuppressedCountRef.current,
        });
        console.log("timings", {
          uiSubmitWaitMs,
          bridgeMs,
          selectorMs: diagnostics.selectorMs,
          filterMs: diagnostics.filterMs,
          lexicalMs: diagnostics.lexicalMs,
          vectorEmbedMs: diagnostics.vectorEmbedMs,
          vectorScanMs: diagnostics.vectorScanMs,
          vectorMs: diagnostics.vectorMs,
          rankMs: diagnostics.rankMs,
          hydrateMs: diagnostics.hydrateMs,
          backendTotalMs: diagnostics.totalMs,
          roundTripMs,
        });
        if (payload.debug?.vectorTopHits?.length) {
          console.table(payload.debug.vectorTopHits.slice(0, 8));
        }
        if (payload.debug?.vectorStats) {
          console.log("vectorStats", payload.debug.vectorStats);
        }
        if (payload.debug?.perItem?.length) {
          console.table(payload.debug.perItem.slice(0, 12));
        }
        console.groupEnd();
      }

      persistRecentQuery(queryText);
    } catch (queryError) {
      if (requestId !== requestIdRef.current) {
        staleSuppressedCountRef.current += 1;
        setStaleSuppressedCount(staleSuppressedCountRef.current);
        return;
      }
      const message = queryError instanceof Error ? queryError.message : "Failed to run query.";
      setError(message);
      setItems([]);
      setResultDebug(null);
      setResultMeta({
        total: 0,
        vectorHits: 0,
        lexicalHits: 0,
        vectorError: null,
        page,
        limit,
        hasMore: false,
        nextCursor: null,
        mode,
      });
      upsertProcessStatus({
        id: "search-query",
        label: "Search query",
        state: "error",
        detail: message,
        retryAction: "RETRY_QUERY",
        updatedAt: Date.now(),
      });
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    activeSpaceId,
    clearProcessStatus,
    cursorAfter,
    cursorPage,
    folders,
    isDebugSearchEnabled,
    queryAnalysis,
    querySubmitMeta,
    queryText,
    requestedScope,
    selectedFolderId,
    sendMessageWithTimeout,
    spaces,
    upsertProcessStatus,
  ]);

  const showEmptySearchState = !isLoading && !error && resultMeta.total === 0;

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    loadSpaces();

    chrome.storage.local.get("sidePanelOpen", (result) => {
      if (result.sidePanelOpen !== undefined) {
        setIsOpen(result.sidePanelOpen);
      }
    });

    const onMessage = (msg: any) => {
      if (msg?.type === "PROCESS_STATUS" && msg.payload) {
        const payload = msg.payload as Partial<SearchProcessStatusItem>;
        if (
          typeof payload.id === "string" &&
          typeof payload.label === "string" &&
          typeof payload.detail === "string" &&
          typeof payload.updatedAt === "number" &&
          (payload.state === "processing" || payload.state === "success" || payload.state === "error")
        ) {
          upsertProcessStatus({
            id: payload.id,
            label: payload.label,
            state: payload.state,
            detail: payload.detail,
            updatedAt: payload.updatedAt,
            retryAction: payload.retryAction as SearchProcessRetryAction | undefined,
          });
        }
        return;
      }

      if (msg?.type !== "DB_CHANGE") return;

      if (msg.scope === "tags") {
        scheduleTagReload();
        return;
      }

      if (msg.scope === "folders") {
        loadFolders();
      }

      if (msg.scope === "spaces") {
        loadSpaces();
        loadFolders();
        scheduleQueryRefresh("high");
        return;
      }

      if (msg.scope === "items" || msg.scope === "folders") {
        scheduleTagReload();
        if (msg.scope === "items" && Array.isArray(msg.changedItemIds) && msg.changedItemIds.length > 0) {
          const changedIds: string[] = msg.changedItemIds.filter(
            (id: unknown): id is string => typeof id === "string"
          );
          const hasVisibleImpact = changedIds.some((id) => visibleItemIdsRef.current.has(id));
          if (!hasVisibleImpact && hasConstrainedQueryRef.current) {
            scheduleQueryRefresh("low");
            return;
          }
        }
        scheduleQueryRefresh("high");
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (tagReloadTimerRef.current !== null) {
        window.clearTimeout(tagReloadTimerRef.current);
        tagReloadTimerRef.current = null;
      }
    };
  }, [loadFolders, loadSpaces, scheduleQueryRefresh, scheduleTagReload, upsertProcessStatus]);

  useEffect(() => {
    void executeQuery();
  }, [refreshToken]);

  const togglePanel = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    chrome.storage.local.set({ sidePanelOpen: newState });
  };

  const setPageDirective = (nextPage: number) => {
    const safePage = Math.max(1, Math.floor(nextPage));
    const nextQueryText = (() => {
      const token = `page:${safePage}`;
      if (/\bpage:\d+\b/i.test(queryText)) {
        return queryText.replace(/\bpage:\d+\b/i, token);
      }
      return `${queryText.trim()} ${token}`.trim();
    })();
    const nextAnalysis = analyzeQuery({
      type: "ANALYZE_QUERY",
      requestId: Date.now(),
      input: nextQueryText,
      cursor: nextQueryText.length,
      forceSuggestions: false,
      catalogs,
    });
    setQueryText(nextQueryText);
    setQueryAnalysis(nextAnalysis);
    setQuerySubmitMeta({
      requestId: nextAnalysis.requestId,
      submittedAt: Date.now(),
      uiDebounceWaitMs: 0,
    });
    setCursorAfter(null);
    setCursorPage(1);
    setCursorHistory([]);
    setRefreshToken((value) => value + 1);
  };

  const useCursorPagination = queryAnalysis.directives.page === undefined;
  const prevDisabled = isLoading || (useCursorPagination ? cursorHistory.length === 0 : resultMeta.page <= 1);
  const nextDisabled = isLoading || (useCursorPagination ? !resultMeta.nextCursor : !resultMeta.hasMore);
  const resultModeFeatures = getQueryModeFeatures(resultMeta.mode);

  const goPrevPage = () => {
    if (!useCursorPagination) {
      setPageDirective(resultMeta.page - 1);
      return;
    }
    if (cursorHistory.length === 0) return;
    const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null;
    setCursorHistory(cursorHistory.slice(0, -1));
    setCursorAfter(previousCursor);
    setCursorPage((value) => Math.max(1, value - 1));
  };

  const goNextPage = () => {
    if (!useCursorPagination) {
      setPageDirective(resultMeta.page + 1);
      return;
    }
    if (!resultMeta.nextCursor) return;
    setCursorHistory((previous) => [...previous, cursorAfter]);
    setCursorAfter(resultMeta.nextCursor);
    setCursorPage((value) => value + 1);
  };

  return (
    <div id="search-results" data-theme={theme} className="min-h-dvh bg-background-page relative">
      <div
        className={cn(
          "fixed top-28 h-[70%] z-50 transition-transform duration-400 ease-in-out peer/sidepanel",
          {
            "left-4": isOpen,
            "-translate-x-[calc(100%+8px)] left-0": !isOpen,
          }
        )}
      >
        <SidePanel className="rounded-xl shadow-sm shadow-foreground-muted/60">
          <div className="flex flex-col gap-2 p-2 w-full h-full overflow-y-auto">
            <div className="px-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-tertiary">
              Spaces
            </div>
            {spaces.map((space) => {
              const isActive = activeSpaceId === space.id;
              const isLocked = space.isPrivate && !space.access.isUnlocked;
              return (
                <button
                  type="button"
                  key={space.id}
                  onClick={() => {
                    void handleSelectSpace(space);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-2 w-full rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer",
                    isActive
                      ? "bg-background-neutral text-foreground-neutral shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_3px_8px_-3px_rgba(0,0,0,0.12)]"
                      : "text-foreground-secondary hover:bg-background-neutral/60"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {space.isPrivate ? (
                      <Shield size={16} className={cn(isActive ? "text-accent" : "text-foreground-icon")} />
                    ) : (
                      <Globe2 size={16} className={cn(isActive ? "text-accent" : "text-foreground-icon")} />
                    )}
                    <span className="truncate text-sm font-semibold">{space.name}</span>
                  </span>
                  {space.isPrivate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-background-neutral-faded px-1.5 py-0.5 text-[10px] font-medium text-foreground-tertiary">
                      <Lock size={10} />
                      {isLocked ? "Locked" : "Open"}
                    </span>
                  )}
                </button>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 justify-start gap-2.5 rounded-xl px-2.5 text-foreground-secondary"
              onClick={() => {
                setCreateSpaceDialogOpen(true);
                setCreateSpaceError(null);
                setCreateSpaceName("");
              }}
            >
              <Plus size={14} />
              New space
            </Button>

            <div className="mt-1 border-t border-border-neutral-faded/70" />
            <div className="px-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-tertiary">
              Groups
            </div>
            <button
              type="button"
              onClick={() => setSelectedFolderId("all")}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer",
                selectedFolderId === "all"
                  ? "bg-background-neutral text-foreground-neutral shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_3px_8px_-3px_rgba(0,0,0,0.12)]"
                  : "text-foreground-secondary hover:bg-background-neutral/60"
              )}
            >
              <Tabs fillColor="#6B95E5" />
              <span className="text-sm font-semibold">All groups</span>
            </button>
            {activeSpaceFolders.map((folder) => (
              <button
                type="button"
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer",
                  selectedFolderId === folder.id
                    ? "bg-background-neutral text-foreground-neutral shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_3px_8px_-3px_rgba(0,0,0,0.12)]"
                    : "text-foreground-secondary hover:bg-background-neutral/60"
                )}
              >
                <Tabs fillColor={folder.isPinned ? "#E56B6B" : "#6B95E5"} />
                <span className="text-sm font-semibold truncate">{folder.name}</span>
              </button>
            ))}
          </div>
        </SidePanel>
      </div>
      <div
        className={cn("peer/bar", {
          "left-[calc(1rem+240px)] fixed top-30 h-[40%] w-8": isOpen,
        })}
      />
      <button
        onClick={togglePanel}
        className={cn(
          "fixed top-34 p-1 z-50 shadow-sm shadow-foreground-muted/60 rounded-semi bg-background-page-secondary transition-all duration-400 ease-in-out group cursor-pointer focus-visible:ring-2 focus-visible:ring-border-neutral/80 focus-visible:ring-offset-1",
          {
            "left-[calc(1rem+240px+8px)]": isOpen,
            "left-2": !isOpen,
            "opacity-100": !isOpen,
            "opacity-0 hover:opacity-100 peer-hover/sidepanel:opacity-100 peer-hover/bar:opacity-100":
              isOpen,
          }
        )}
      >
        <ChevronRight
          className={cn("h-5 w-5 transition-all duration-300 text-foreground-tertiary", {
            "rotate-180": isOpen,
          })}
        />
      </button>

      <div className="mt-3">
        <SearchQueryBar
          committedValue={queryText}
          onSubmit={handleSubmitQuery}
          catalogs={catalogs}
          placeholder="Search anything…"
        />
        <div className="w-full max-w-5xl mx-auto mt-1 px-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-[11px] text-foreground-tertiary">
            <span className="inline-flex items-center gap-1 rounded-full border border-border-neutral-faded px-2 py-1 text-foreground-secondary">
              {isPrivateSpaceActive ? <Shield size={12} /> : <Globe2 size={12} />}
              {activeSpace?.name || "Public"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border-neutral-faded px-2 py-1 text-foreground-secondary">
              Scope: {requestedScopeLabel}
            </span>
            {isPrivateSpaceActive && isPrivateUnlocked && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 rounded-full px-2 text-[11px]"
                onClick={() => {
                  setChangePasswordDialogOpen(true);
                  setChangePasswordCurrent("");
                  setChangePasswordNext("");
                  setChangePasswordConfirm("");
                  setChangePasswordError(null);
                }}
              >
                Change password
              </Button>
            )}
            {isDevBuild && (
              <Button
                type="button"
                variant={isDebugSearchEnabled ? "secondary" : "ghost"}
                size="sm"
                className="h-6 rounded-full px-2 text-[11px]"
                onClick={() => setIsDebugSearchEnabled((prev) => !prev)}
              >
                {isDebugSearchEnabled ? "Debug on" : "Debug off"}
              </Button>
            )}
          </div>
          <SearchProcessStatus
            statuses={processStatuses}
            retryingId={retryingProcessId}
            onRetry={triggerRetryAction}
          />
        </div>
      </div>

      <div className="w-full max-w-5xl mx-auto mt-3 px-1">
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-foreground-secondary">
          <div className="truncate">
            {isLoading
              ? "Searching local data..."
              : `${resultMeta.total} result${resultMeta.total === 1 ? "" : "s"} • space:${activeSpace?.name || "Public"} • scope:${requestedScope} • mode:${resultMeta.mode} • page ${resultMeta.page} • ${resultMeta.lexicalHits} lexical hit${resultMeta.lexicalHits === 1 ? "" : "s"}${
                  resultModeFeatures.vector
                    ? ` • ${resultMeta.vectorHits} vector hit${resultMeta.vectorHits === 1 ? "" : "s"}`
                    : ""
                }${resultMeta.hasMore ? " • more available" : ""}${
                  isDebugSearchEnabled && topDebugVectorHit
                    ? ` • top vector ${topDebugVectorHit.score.toFixed(3)}`
                    : ""
                }${
                  isDebugSearchEnabled ? ` • stale suppressed ${staleSuppressedCount}` : ""
                }`}
            {resultMeta.vectorError ? ` • vector error: ${resultMeta.vectorError}` : ""}
            {error ? ` • error: ${error}` : ""}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={prevDisabled}
              onClick={goPrevPage}
              className="h-7 px-2 text-xs"
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={nextDisabled}
              onClick={goNextPage}
              className="h-7 px-2 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={unlockDialogOpen}
        onOpenChange={(open) => {
          if (unlockDialogLoading) return;
          setUnlockDialogOpen(open);
          if (!open) {
            setUnlockDialogMode(privateSpace?.access.requiresPassword ? "setup" : "unlock");
            resetUnlockDialogState();
          }
        }}
      >
        <DialogContent className="flex w-full max-w-md flex-col gap-5 rounded-3xl p-6 sm:max-w-md">
          <DialogHeader>
            <div className="mb-1.5 flex size-12 items-center justify-center rounded-2xl bg-foreground-neutral text-background-neutral shadow-[0_6px_16px_-4px_rgba(0,0,0,0.3)]">
              <Lock size={20} />
            </div>
            <DialogTitle className="font-sans-bold text-xl tracking-[-0.01em] text-foreground-neutral">
              {unlockDialogMode === "setup"
                ? "Lock your private space"
                : unlockDialogMode === "recovery"
                  ? "Reset your password"
                  : "Private space"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-foreground-secondary">
              {unlockDialogMode === "setup"
                ? "Set a password to keep these folders and tabs hidden on this device."
                : unlockDialogMode === "recovery"
                  ? "Answer your recovery questions to set a new password."
                  : "Enter your password to view private folders and tabs."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {(unlockDialogMode === "unlock" || unlockDialogMode === "setup") && (
              <Input
                type="password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                placeholder="Password"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void submitPrivateAccess();
                  }
                }}
              />
            )}
            {(unlockDialogMode === "setup" || unlockDialogMode === "recovery") && (
              <Input
                type="password"
                value={unlockConfirmPassword}
                onChange={(event) => setUnlockConfirmPassword(event.target.value)}
                placeholder={
                  unlockDialogMode === "setup" ? "Confirm password" : "Confirm new password"
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void submitPrivateAccess();
                  }
                }}
              />
            )}
            {unlockDialogMode === "setup" && (
              <div className="space-y-2.5 border-t border-border-neutral-faded pt-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-tertiary">
                    Recovery questions
                  </p>
                  <p className="mt-0.5 text-xs text-foreground-secondary">
                    The only way back in if you forget your password.
                  </p>
                </div>
                <Input
                  value={unlockQuestion1}
                  onChange={(event) => setUnlockQuestion1(event.target.value)}
                  placeholder="Recovery question 1"
                />
                <Input
                  value={unlockAnswer1}
                  onChange={(event) => setUnlockAnswer1(event.target.value)}
                  placeholder="Answer 1"
                />
                <Input
                  value={unlockQuestion2}
                  onChange={(event) => setUnlockQuestion2(event.target.value)}
                  placeholder="Recovery question 2"
                />
                <Input
                  value={unlockAnswer2}
                  onChange={(event) => setUnlockAnswer2(event.target.value)}
                  placeholder="Answer 2"
                />
              </div>
            )}
            {unlockDialogMode === "recovery" && (
              <>
                <div className="rounded-lg border border-border-neutral-faded bg-background-neutral/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-foreground-tertiary">
                    Recovery question 1
                  </p>
                  <p className="mt-0.5 text-sm text-foreground-secondary">
                    {privateSpace?.access.recoveryQuestions[0] || "Question unavailable"}
                  </p>
                </div>
                <Input
                  value={unlockAnswer1}
                  onChange={(event) => setUnlockAnswer1(event.target.value)}
                  placeholder="Answer 1"
                  autoFocus
                />
                <div className="rounded-lg border border-border-neutral-faded bg-background-neutral/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-foreground-tertiary">
                    Recovery question 2
                  </p>
                  <p className="mt-0.5 text-sm text-foreground-secondary">
                    {privateSpace?.access.recoveryQuestions[1] || "Question unavailable"}
                  </p>
                </div>
                <Input
                  value={unlockAnswer2}
                  onChange={(event) => setUnlockAnswer2(event.target.value)}
                  placeholder="Answer 2"
                />
                <Input
                  type="password"
                  value={unlockPassword}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                  placeholder="New password"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void submitPrivateAccess();
                    }
                  }}
                />
              </>
            )}
            {unlockDialogError && (
              <p className="text-xs text-foreground-danger">{unlockDialogError}</p>
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <div className="flex items-center gap-2">
              {unlockDialogMode === "unlock" && privateSpace?.access.hasRecovery && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setUnlockDialogMode("recovery");
                    setUnlockDialogError(null);
                    setUnlockPassword("");
                    setUnlockConfirmPassword("");
                    setUnlockAnswer1("");
                    setUnlockAnswer2("");
                  }}
                  disabled={unlockDialogLoading}
                >
                  Forgot password?
                </Button>
              )}
              {unlockDialogMode === "recovery" && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setUnlockDialogMode("unlock");
                    setUnlockDialogError(null);
                    setUnlockPassword("");
                    setUnlockConfirmPassword("");
                    setUnlockAnswer1("");
                    setUnlockAnswer2("");
                  }}
                  disabled={unlockDialogLoading}
                >
                  Use password instead
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnlockDialogOpen(false)}
              disabled={unlockDialogLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitPrivateAccess();
              }}
              disabled={unlockDialogLoading}
            >
              {unlockDialogLoading
                ? "Please wait..."
                : unlockDialogMode === "setup"
                  ? "Save and unlock"
                  : unlockDialogMode === "recovery"
                    ? "Recover and unlock"
                    : "Unlock"}
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={changePasswordDialogOpen}
        onOpenChange={(open) => {
          if (changePasswordLoading) return;
          setChangePasswordDialogOpen(open);
          if (!open) {
            setChangePasswordCurrent("");
            setChangePasswordNext("");
            setChangePasswordConfirm("");
            setChangePasswordError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change private password</DialogTitle>
            <DialogDescription>
              Update your private space password. Recovery questions stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input
              type="password"
              value={changePasswordCurrent}
              onChange={(event) => setChangePasswordCurrent(event.target.value)}
              placeholder="Current password"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitPasswordChange();
                }
              }}
            />
            <Input
              type="password"
              value={changePasswordNext}
              onChange={(event) => setChangePasswordNext(event.target.value)}
              placeholder="New password"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitPasswordChange();
                }
              }}
            />
            <Input
              type="password"
              value={changePasswordConfirm}
              onChange={(event) => setChangePasswordConfirm(event.target.value)}
              placeholder="Confirm new password"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitPasswordChange();
                }
              }}
            />
            {changePasswordError && (
              <p className="text-xs text-foreground-danger">{changePasswordError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setChangePasswordDialogOpen(false)}
              disabled={changePasswordLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitPasswordChange();
              }}
              disabled={changePasswordLoading}
            >
              {changePasswordLoading ? "Updating..." : "Update password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createSpaceDialogOpen}
        onOpenChange={(open) => {
          if (createSpaceLoading) return;
          setCreateSpaceDialogOpen(open);
          if (!open) {
            setCreateSpaceError(null);
            setCreateSpaceName("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create a new space</DialogTitle>
            <DialogDescription>
              Spaces keep your folders separate without adding search clutter.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Input
              value={createSpaceName}
              onChange={(event) => setCreateSpaceName(event.target.value)}
              placeholder="Space name"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitCreateSpace();
                }
              }}
            />
            {createSpaceError && <p className="text-xs text-foreground-danger">{createSpaceError}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateSpaceDialogOpen(false)}
              disabled={createSpaceLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitCreateSpace();
              }}
              disabled={createSpaceLoading}
            >
              {createSpaceLoading ? "Creating..." : "Create space"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showEmptySearchState ? (
        <div className="w-full max-w-5xl mx-auto mt-10 rounded-xl border border-border-neutral-faded bg-background-page-secondary/80 px-6 py-8 text-center">
          <p className="text-base font-semibold text-foreground-neutral">No matching results</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            Try a broader query, change scope, or remove a few filters.
          </p>
          {queryText.trim().length > 0 && (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const clearedAnalysis = analyzeQuery({
                    type: "ANALYZE_QUERY",
                    requestId: Date.now(),
                    input: "",
                    cursor: 0,
                    catalogs,
                    forceSuggestions: false,
                  });
                  setQueryText("");
                  setQueryAnalysis(clearedAnalysis);
                  setQuerySubmitMeta(null);
                  setResultDebug(null);
                  setCursorAfter(null);
                  setCursorPage(1);
                  setCursorHistory([]);
                  setRefreshToken((value) => value + 1);
                }}
              >
                Clear query
              </Button>
            </div>
          )}
        </div>
      ) : (
        <TabGroups
          folders={visibleFolders}
          items={items}
          spaces={spaces}
          preserveInputOrder={preserveInputOrder}
          debugScoresByItemId={isDebugSearchEnabled ? debugScoresByItemId : undefined}
          showDebugScores={isDebugSearchEnabled}
        />
      )}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          duration: 2800,
        }}
      />
    </div>
  );
};

export default Search;
