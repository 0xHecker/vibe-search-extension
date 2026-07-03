import {
  DEFAULT_PRIVATE_AUTO_LOCK_MS,
  LIVE_SPACE_SELECTOR,
  PRIVATE_PASSWORD_MIN_LENGTH,
  PRIVATE_SPACE_ID,
  PRIVATE_SPACE_NAME,
  PUBLIC_SPACE_ID,
  PUBLIC_SPACE_NAME,
  SPACE_NOT_BINNED,
  computeBinPurgeAt,
  isSpacePurgeable,
  normalizeSpaceName,
  slugifySpaceName,
} from "@src/common/spaces";
import { SpaceDocType, UNGROUPED_SPACE_GROUP_ID } from "@src/schemas/space_schema";
import { getDb } from "@src/services/DatabaseService";
import {
  DEFAULT_PASSWORD_ITERATIONS,
  hashRecoveryAnswer,
  hashPassword,
  verifyRecoveryAnswer,
  verifyPassword,
} from "@src/services/password-hash.service";
import { spaceSessionService } from "@src/services/space-session.service";
import { appendUnorderedIds } from "@src/utils/ordered-ids";

type SpaceAccessView = {
  isUnlocked: boolean;
  requiresPassword: boolean;
  hasRecovery: boolean;
  recoveryQuestions: string[];
  autoLockMs: number;
  remainingMs?: number;
  lastActivityAt?: number;
};

type RecoveryQuestionInput = {
  question: string;
  answer: string;
};

type AuthAttemptState = {
  windowStartedAt: number;
  failures: number;
  blockedUntil?: number;
};

const AUTH_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const AUTH_ATTEMPT_MAX_FAILURES = 5;
const AUTH_ATTEMPT_BLOCK_MS = 2 * 60 * 1000;
const SPACE_ASSIGNMENT_REPAIR_VERSION = 1;

export type SpaceListItem = {
  id: string;
  name: string;
  slug: string;
  spaceGroupId: string | null;
  isPrivate: boolean;
  sortOrder: number;
  isArchived: boolean;
  deletedAt: number;
  purgeAt: number;
  createdAt: number;
  updatedAt: number;
  access: SpaceAccessView;
};

const buildSpaceId = () => crypto.randomUUID?.() ?? `space_${Date.now()}_${Math.random()}`;

const safeSlug = (name: string, fallback: string): string => {
  const slug = slugifySpaceName(name);
  return slug || fallback;
};

export class SpacesController {
  [key: string]: any;
  private authAttempts = new Map<string, AuthAttemptState>();
  private recoveryPepperStorageKey = "vibe.search.recoveryPepper.v1";
  private spaceRepairVersionStorageKey = "vibe.search.spaceRepair.version";

  private normalizeUserId(userId: string | null | undefined): string {
    return typeof userId === "string" ? userId : "";
  }

  private authKey(spaceId: string, flow: "unlock" | "recover" | "change" | "set"): string {
    return `${flow}:${spaceId}`;
  }

  private assertAuthNotRateLimited(key: string): void {
    const now = Date.now();
    const state = this.authAttempts.get(key);
    if (!state) return;
    if (state.blockedUntil && state.blockedUntil > now) {
      throw new Error("TOO_MANY_ATTEMPTS_RETRY_LATER");
    }
    if (state.blockedUntil && state.blockedUntil <= now) {
      this.authAttempts.delete(key);
    }
  }

  private recordAuthFailure(key: string): void {
    const now = Date.now();
    const existing = this.authAttempts.get(key);
    if (!existing || now - existing.windowStartedAt > AUTH_ATTEMPT_WINDOW_MS) {
      this.authAttempts.set(key, {
        windowStartedAt: now,
        failures: 1,
      });
      return;
    }

    const failures = existing.failures + 1;
    this.authAttempts.set(key, {
      windowStartedAt: existing.windowStartedAt,
      failures,
      blockedUntil: failures >= AUTH_ATTEMPT_MAX_FAILURES ? now + AUTH_ATTEMPT_BLOCK_MS : existing.blockedUntil,
    });
  }

  private clearAuthFailures(key: string): void {
    this.authAttempts.delete(key);
  }

  private normalizeQuestion(value: string): string {
    return value.trim().replace(/\s+/g, " ").slice(0, 160);
  }

  private randomPepper(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    let binary = "";
    for (const value of bytes) {
      binary += String.fromCharCode(value);
    }
    return btoa(binary);
  }

  private async readLocalStorageValue(key: string): Promise<string | undefined> {
    const db = await getDb();
    const value = (await db.getLocal(key))?.get("value");
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private async writeLocalStorageValue(key: string, value: string): Promise<void> {
    const db = await getDb();
    await db.upsertLocal(key, { value });
  }

  private async readLocalStorageNumber(key: string): Promise<number | undefined> {
    const db = await getDb();
    const value = (await db.getLocal(key))?.get("value");
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private async writeLocalStorageNumber(key: string, value: number): Promise<void> {
    const db = await getDb();
    await db.upsertLocal(key, { value });
  }

  private async getRecoveryPepper(): Promise<string> {
    const existing = await this.readLocalStorageValue(this.recoveryPepperStorageKey);
    if (existing) return existing;
    const created = this.randomPepper();
    await this.writeLocalStorageValue(this.recoveryPepperStorageKey, created);
    return created;
  }

  private async verifyPrivatePasswordForSpace(space: SpaceDocType, password: string): Promise<boolean> {
    if (!space.passwordHash || !space.passwordSalt) return false;
    return verifyPassword(password, {
      salt: space.passwordSalt,
      hash: space.passwordHash,
      iterations: space.passwordIterations || DEFAULT_PASSWORD_ITERATIONS,
    });
  }

  private normalizeRecoveryQuestions(input: RecoveryQuestionInput[]): RecoveryQuestionInput[] {
    return input
      .map((row) => ({
        question: this.normalizeQuestion(row.question || ""),
        answer: (row.answer || "").trim(),
      }))
      .filter((row) => row.question.length > 0 && row.answer.length > 0)
      .slice(0, 2);
  }

  private toListItem(space: SpaceDocType): SpaceListItem {
    const isUnlocked = space.isPrivate ? spaceSessionService.isUnlocked(space.id) : true;
    const session = spaceSessionService.getState(space.id);
    const requiresPassword = space.isPrivate && !(space.passwordHash && space.passwordSalt);
    const recoveryQuestions = [space.recoveryQuestion1, space.recoveryQuestion2]
      .map((row) => (row || "").trim())
      .filter(Boolean);
    return {
      id: space.id,
      name: space.name,
      slug: space.slug,
      spaceGroupId: space.spaceGroupId || null,
      isPrivate: space.isPrivate,
      sortOrder: space.sortOrder,
      isArchived: space.isArchived,
      deletedAt: space.deletedAt || SPACE_NOT_BINNED,
      purgeAt: space.purgeAt || 0,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
      access: {
        isUnlocked,
        requiresPassword,
        hasRecovery:
          recoveryQuestions.length === 2 &&
          !!space.recoveryHash1 &&
          !!space.recoverySalt1 &&
          !!space.recoveryHash2 &&
          !!space.recoverySalt2,
        recoveryQuestions,
        autoLockMs: space.autoLockMs || DEFAULT_PRIVATE_AUTO_LOCK_MS,
        remainingMs: session.remainingMs,
        lastActivityAt: session.lastActivityAt,
      },
    };
  }

  async ensureDefaults(): Promise<void> {
    const db = await getDb();
    const now = Date.now();
    const existing = await db.spaces.findByIds([PUBLIC_SPACE_ID, PRIVATE_SPACE_ID]).exec();
    const upserts: SpaceDocType[] = [];

    if (!existing.has(PUBLIC_SPACE_ID)) {
      upserts.push({
        id: PUBLIC_SPACE_ID,
        name: PUBLIC_SPACE_NAME,
        slug: "public",
        spaceGroupId: UNGROUPED_SPACE_GROUP_ID,
        isPrivate: false,
        autoLockMs: DEFAULT_PRIVATE_AUTO_LOCK_MS,
        sortOrder: 0,
        isArchived: false,
        deletedAt: SPACE_NOT_BINNED,
        purgeAt: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!existing.has(PRIVATE_SPACE_ID)) {
      upserts.push({
        id: PRIVATE_SPACE_ID,
        name: PRIVATE_SPACE_NAME,
        slug: "private",
        spaceGroupId: UNGROUPED_SPACE_GROUP_ID,
        isPrivate: true,
        autoLockMs: DEFAULT_PRIVATE_AUTO_LOCK_MS,
        sortOrder: 1,
        isArchived: false,
        deletedAt: SPACE_NOT_BINNED,
        purgeAt: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (upserts.length > 0) {
      await db.spaces.bulkUpsert(upserts);
    }
  }

  async repairFolderAndItemSpaceAssignments(): Promise<{
    folderUpdates: number;
    itemUpdates: number;
  }> {
    const db = await getDb();
    await this.ensureDefaults();

    const [spaceDocs, folderDocs, itemDocs] = await Promise.all([
      db.spaces.find({ selector: { isArchived: { $eq: false } } }).exec(),
      db.folders.find().exec(),
      db.items.find().exec(),
    ]);

    const validSpaceIds = new Set(spaceDocs.map((doc) => doc.get("id") as string));
    if (!validSpaceIds.has(PUBLIC_SPACE_ID)) {
      validSpaceIds.add(PUBLIC_SPACE_ID);
    }

    const folderUpdates: any[] = [];
    for (const folderDoc of folderDocs) {
      const raw = folderDoc.toMutableJSON();
      const currentSpaceId = (raw as any).spaceId as string | undefined;
      const nextSpaceId =
        currentSpaceId && validSpaceIds.has(currentSpaceId) ? currentSpaceId : PUBLIC_SPACE_ID;
      if (currentSpaceId !== nextSpaceId) {
        folderUpdates.push({
          ...raw,
          userId: this.normalizeUserId((raw as any).userId),
          spaceId: nextSpaceId,
          updatedAt: Date.now(),
        });
      }
    }
    if (folderUpdates.length > 0) {
      await db.folders.bulkUpsert(folderUpdates);
    }

    const effectiveFolderDocs =
      folderUpdates.length > 0 ? await db.folders.find().exec() : folderDocs;
    const folderSpaceById = new Map<string, string>();
    for (const folderDoc of effectiveFolderDocs) {
      const json = folderDoc.toMutableJSON() as any;
      folderSpaceById.set(json.id, json.spaceId || PUBLIC_SPACE_ID);
    }

    const itemUpdates: any[] = [];
    for (const itemDoc of itemDocs) {
      const raw = itemDoc.toMutableJSON() as any;
      const currentSpaceId = raw.spaceId as string | undefined;
      const folderSpace = folderSpaceById.get(raw.folderId);
      const targetSpaceId =
        folderSpace ||
        (currentSpaceId && validSpaceIds.has(currentSpaceId) ? currentSpaceId : PUBLIC_SPACE_ID);
      if (currentSpaceId !== targetSpaceId) {
        itemUpdates.push({
          ...raw,
          userId: this.normalizeUserId(raw.userId as string | null | undefined),
          spaceId: targetSpaceId,
          updatedAt: Date.now(),
        });
      }
    }
    if (itemUpdates.length > 0) {
      await db.items.bulkUpsert(itemUpdates);
    }

    if (folderUpdates.length > 0 || itemUpdates.length > 0) {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
      } catch {}
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
    }

    return {
      folderUpdates: folderUpdates.length,
      itemUpdates: itemUpdates.length,
    };
  }

  async maybeRepairFolderAndItemSpaceAssignments(): Promise<{
    repaired: boolean;
    folderUpdates: number;
    itemUpdates: number;
  }> {
    const repairedVersion = await this.readLocalStorageNumber(this.spaceRepairVersionStorageKey);
    if (repairedVersion === SPACE_ASSIGNMENT_REPAIR_VERSION) {
      return {
        repaired: false,
        folderUpdates: 0,
        itemUpdates: 0,
      };
    }

    const result = await this.repairFolderAndItemSpaceAssignments();
    await this.writeLocalStorageNumber(
      this.spaceRepairVersionStorageKey,
      SPACE_ASSIGNMENT_REPAIR_VERSION
    );
    return {
      repaired: true,
      folderUpdates: result.folderUpdates,
      itemUpdates: result.itemUpdates,
    };
  }

  async listSpaces(): Promise<SpaceListItem[]> {
    await this.ensureDefaults();
    const db = await getDb();
    const docs = await db.spaces
      .find({ selector: { ...LIVE_SPACE_SELECTOR } })
      .exec();
    return docs
      .map((doc) => this.toListItem(doc.toMutableJSON() as SpaceDocType))
      .sort((a, b) => {
        if (!!a.isPrivate !== !!b.isPrivate) return a.isPrivate ? 1 : -1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.createdAt - b.createdAt;
      });
  }

  async createSpace(payload: { name: string; spaceGroupId?: string | null }): Promise<SpaceListItem> {
    const db = await getDb();
    await this.ensureDefaults();
    const now = Date.now();
    const name = normalizeSpaceName(payload.name || "");
    if (!name) {
      throw new Error("SPACE_NAME_REQUIRED");
    }
    const requestedGroupId = typeof payload.spaceGroupId === "string" ? payload.spaceGroupId.trim() : "";
    if (requestedGroupId) {
      const group = await db.space_groups.findOne(requestedGroupId).exec();
      if (!group) throw new Error("SPACE_GROUP_NOT_FOUND");
    }

    const existing = await db.spaces.find({ selector: { isArchived: { $eq: false } } }).exec();
    const existingNames = new Set(
      existing.map((doc) => ((doc.get("name") as string) || "").toLowerCase())
    );
    if (existingNames.has(name.toLowerCase())) {
      throw new Error("SPACE_NAME_EXISTS");
    }

    const maxSortOrder = existing.reduce((max, doc) => {
      const value = (doc.get("sortOrder") as number | undefined) ?? 0;
      return Math.max(max, value);
    }, 0);

    const space: SpaceDocType = {
      id: buildSpaceId(),
      name,
      slug: safeSlug(name, `space-${now}`),
      spaceGroupId: requestedGroupId || UNGROUPED_SPACE_GROUP_ID,
      isPrivate: false,
      autoLockMs: DEFAULT_PRIVATE_AUTO_LOCK_MS,
      sortOrder: maxSortOrder + 1,
      isArchived: false,
      deletedAt: SPACE_NOT_BINNED,
      purgeAt: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.spaces.insert(space);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return this.toListItem(space);
  }

  async renameSpace(payload: { id: string; name: string }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await db.spaces.findOne(payload.id).exec();
    if (!doc) return { success: false };
    const current = doc.toMutableJSON() as SpaceDocType;
    if (current.id === PUBLIC_SPACE_ID || current.id === PRIVATE_SPACE_ID) {
      throw new Error("SPACE_RENAME_NOT_ALLOWED");
    }
    const nextName = normalizeSpaceName(payload.name || "");
    if (!nextName) {
      throw new Error("SPACE_NAME_REQUIRED");
    }
    const existing = await db.spaces.find({ selector: { isArchived: { $eq: false } } }).exec();
    const duplicate = existing.some((row) => {
      const rowId = row.get("id") as string;
      const rowName = ((row.get("name") as string) || "").toLowerCase();
      return rowId !== current.id && rowName === nextName.toLowerCase();
    });
    if (duplicate) {
      throw new Error("SPACE_NAME_EXISTS");
    }
    await doc.patch({
      name: nextName,
      slug: safeSlug(nextName, current.slug),
      updatedAt: Date.now(),
    });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async moveToSpaceGroup(payload: {
    spaceId: string;
    spaceGroupId: string | null;
  }): Promise<{ success: boolean }> {
    const db = await getDb();
    const space = await db.spaces.findOne(payload.spaceId).exec();
    if (!space) return { success: false };

    const current = space.toMutableJSON() as SpaceDocType;
    if (current.id === PUBLIC_SPACE_ID || current.id === PRIVATE_SPACE_ID) {
      throw new Error("DEFAULT_SPACE_GROUP_MOVE_NOT_ALLOWED");
    }
    const groupId = typeof payload.spaceGroupId === "string" ? payload.spaceGroupId.trim() : "";
    if (groupId) {
      const group = await db.space_groups.findOne(groupId).exec();
      if (!group) throw new Error("SPACE_GROUP_NOT_FOUND");
    }
    await space.patch({ spaceGroupId: groupId || UNGROUPED_SPACE_GROUP_ID, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async setPrivatePassword(payload: {
    spaceId?: string;
    password: string;
    currentPassword?: string;
    recoveryQuestions?: RecoveryQuestionInput[];
  }): Promise<{ success: boolean }> {
    const db = await getDb();
    await this.ensureDefaults();
    const spaceId = payload.spaceId || PRIVATE_SPACE_ID;
    const password = payload.password || "";
    if (password.length < PRIVATE_PASSWORD_MIN_LENGTH) {
      throw new Error("PASSWORD_TOO_SHORT");
    }
    const doc = await db.spaces.findOne(spaceId).exec();
    if (!doc) {
      throw new Error("SPACE_NOT_FOUND");
    }
    const space = doc.toMutableJSON() as SpaceDocType;
    if (!space.isPrivate) {
      throw new Error("SPACE_NOT_PRIVATE");
    }
    const hasPasswordConfigured = !!space.passwordHash && !!space.passwordSalt;
    if (hasPasswordConfigured) {
      const authKey = this.authKey(space.id, "set");
      this.assertAuthNotRateLimited(authKey);
      if (!(payload.currentPassword || "").trim()) {
        throw new Error("PASSWORD_ALREADY_CONFIGURED");
      }
      const valid = await this.verifyPrivatePasswordForSpace(space, payload.currentPassword || "");
      if (!valid) {
        this.recordAuthFailure(authKey);
        throw new Error("INVALID_PASSWORD");
      }
      this.clearAuthFailures(authKey);
    }
    const normalizedRecovery = this.normalizeRecoveryQuestions(payload.recoveryQuestions || []);
    if (normalizedRecovery.length !== 2) {
      throw new Error("TWO_RECOVERY_QUESTIONS_REQUIRED");
    }

    const hashed = await hashPassword(password);
    const pepper = await this.getRecoveryPepper();
    const recovery1 = await hashRecoveryAnswer(normalizedRecovery[0].answer, { pepper });
    const recovery2 = await hashRecoveryAnswer(normalizedRecovery[1].answer, { pepper });
    await doc.patch({
      passwordSalt: hashed.salt,
      passwordHash: hashed.hash,
      passwordIterations: hashed.iterations,
      passwordVersion: 1,
      recoveryQuestion1: normalizedRecovery[0].question,
      recoveryQuestion2: normalizedRecovery[1].question,
      recoverySalt1: recovery1.salt,
      recoveryHash1: recovery1.hash,
      recoveryIterations1: recovery1.iterations,
      recoverySalt2: recovery2.salt,
      recoveryHash2: recovery2.hash,
      recoveryIterations2: recovery2.iterations,
      updatedAt: Date.now(),
    });
    spaceSessionService.unlockSpace(space.id, space.autoLockMs || DEFAULT_PRIVATE_AUTO_LOCK_MS);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async unlockSpace(payload: { spaceId?: string; password: string }): Promise<{ success: boolean }> {
    const db = await getDb();
    await this.ensureDefaults();
    const spaceId = payload.spaceId || PRIVATE_SPACE_ID;
    const password = payload.password || "";
    const doc = await db.spaces.findOne(spaceId).exec();
    if (!doc) {
      throw new Error("SPACE_NOT_FOUND");
    }
    const space = doc.toMutableJSON() as SpaceDocType;
    if (!space.isPrivate) {
      return { success: true };
    }

    if (!space.passwordHash || !space.passwordSalt) {
      throw new Error("PASSWORD_NOT_CONFIGURED");
    }

    const authKey = this.authKey(space.id, "unlock");
    this.assertAuthNotRateLimited(authKey);
    const valid = await this.verifyPrivatePasswordForSpace(space, password);
    if (!valid) {
      this.recordAuthFailure(authKey);
      throw new Error("INVALID_PASSWORD");
    }
    this.clearAuthFailures(authKey);

    spaceSessionService.unlockSpace(space.id, space.autoLockMs || DEFAULT_PRIVATE_AUTO_LOCK_MS);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async changePrivatePassword(payload: {
    spaceId?: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean }> {
    const db = await getDb();
    await this.ensureDefaults();
    const spaceId = payload.spaceId || PRIVATE_SPACE_ID;
    const doc = await db.spaces.findOne(spaceId).exec();
    if (!doc) throw new Error("SPACE_NOT_FOUND");
    const space = doc.toMutableJSON() as SpaceDocType;
    if (!space.isPrivate) throw new Error("SPACE_NOT_PRIVATE");
    if (payload.newPassword.length < PRIVATE_PASSWORD_MIN_LENGTH) throw new Error("PASSWORD_TOO_SHORT");

    const authKey = this.authKey(space.id, "change");
    this.assertAuthNotRateLimited(authKey);
    const valid = await this.verifyPrivatePasswordForSpace(space, payload.currentPassword || "");
    if (!valid) {
      this.recordAuthFailure(authKey);
      throw new Error("INVALID_PASSWORD");
    }
    this.clearAuthFailures(authKey);

    const hashed = await hashPassword(payload.newPassword);
    await doc.patch({
      passwordSalt: hashed.salt,
      passwordHash: hashed.hash,
      passwordIterations: hashed.iterations,
      passwordVersion: 1,
      updatedAt: Date.now(),
    });
    spaceSessionService.unlockSpace(space.id, space.autoLockMs || DEFAULT_PRIVATE_AUTO_LOCK_MS);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async recoverPrivatePassword(payload: {
    spaceId?: string;
    answer1: string;
    answer2: string;
    newPassword: string;
  }): Promise<{ success: boolean }> {
    const db = await getDb();
    await this.ensureDefaults();
    const spaceId = payload.spaceId || PRIVATE_SPACE_ID;
    const doc = await db.spaces.findOne(spaceId).exec();
    if (!doc) throw new Error("SPACE_NOT_FOUND");
    const space = doc.toMutableJSON() as SpaceDocType;
    if (!space.isPrivate) throw new Error("SPACE_NOT_PRIVATE");
    if (payload.newPassword.length < PRIVATE_PASSWORD_MIN_LENGTH) throw new Error("PASSWORD_TOO_SHORT");
    if (
      !space.recoveryHash1 ||
      !space.recoverySalt1 ||
      !space.recoveryHash2 ||
      !space.recoverySalt2
    ) {
      throw new Error("RECOVERY_NOT_CONFIGURED");
    }

    const authKey = this.authKey(space.id, "recover");
    this.assertAuthNotRateLimited(authKey);
    const pepper = await this.getRecoveryPepper();
    const verifyPair = async (overridePepper?: string): Promise<[boolean, boolean]> =>
      Promise.all([
        verifyRecoveryAnswer(
          payload.answer1 || "",
          {
            salt: space.recoverySalt1!,
            hash: space.recoveryHash1!,
            iterations: space.recoveryIterations1 || DEFAULT_PASSWORD_ITERATIONS,
          },
          { pepper: overridePepper }
        ),
        verifyRecoveryAnswer(
          payload.answer2 || "",
          {
            salt: space.recoverySalt2!,
            hash: space.recoveryHash2!,
            iterations: space.recoveryIterations2 || DEFAULT_PASSWORD_ITERATIONS,
          },
          { pepper: overridePepper }
        ),
      ]);

    let [ok1, ok2] = await verifyPair(pepper);
    let usedLegacyPepper = false;
    if (!ok1 || !ok2) {
      const [legacyOk1, legacyOk2] = await verifyPair(undefined);
      if (legacyOk1 && legacyOk2) {
        usedLegacyPepper = true;
        ok1 = legacyOk1;
        ok2 = legacyOk2;
      }
    }

    if (!ok1 || !ok2) {
      this.recordAuthFailure(authKey);
      throw new Error("RECOVERY_ANSWERS_INVALID");
    }
    this.clearAuthFailures(authKey);

    const hashed = await hashPassword(payload.newPassword);
    const legacyRecoveryMigration = usedLegacyPepper
      ? await Promise.all([
          hashRecoveryAnswer(payload.answer1 || "", { pepper }),
          hashRecoveryAnswer(payload.answer2 || "", { pepper }),
        ])
      : null;
    await doc.patch({
      passwordSalt: hashed.salt,
      passwordHash: hashed.hash,
      passwordIterations: hashed.iterations,
      passwordVersion: 1,
      recoverySalt1: legacyRecoveryMigration?.[0].salt ?? space.recoverySalt1,
      recoveryHash1: legacyRecoveryMigration?.[0].hash ?? space.recoveryHash1,
      recoveryIterations1:
        legacyRecoveryMigration?.[0].iterations ?? space.recoveryIterations1,
      recoverySalt2: legacyRecoveryMigration?.[1].salt ?? space.recoverySalt2,
      recoveryHash2: legacyRecoveryMigration?.[1].hash ?? space.recoveryHash2,
      recoveryIterations2:
        legacyRecoveryMigration?.[1].iterations ?? space.recoveryIterations2,
      updatedAt: Date.now(),
    });
    spaceSessionService.unlockSpace(space.id, space.autoLockMs || DEFAULT_PRIVATE_AUTO_LOCK_MS);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async lockSpace(payload: { spaceId?: string }): Promise<{ success: boolean }> {
    const spaceId = payload.spaceId || PRIVATE_SPACE_ID;
    spaceSessionService.lockSpace(spaceId);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }

  async touchSpaceActivity(payload: { spaceId: string }): Promise<{ success: boolean }> {
    if (!payload.spaceId) return { success: false };
    return { success: spaceSessionService.touchSpace(payload.spaceId) };
  }

  async getSpaceAccessState(payload?: { spaceId?: string }): Promise<{
    access: Record<
      string,
      {
        isUnlocked: boolean;
        remainingMs?: number;
        lastActivityAt?: number;
      }
    >;
  }> {
    await this.ensureDefaults();
    const db = await getDb();
    const ids = payload?.spaceId
      ? [payload.spaceId]
      : (await db.spaces.find({ selector: { isArchived: { $eq: false } } }).exec()).map(
          (doc) => doc.get("id") as string
        );
    const access: Record<
      string,
      {
        isUnlocked: boolean;
        remainingMs?: number;
        lastActivityAt?: number;
      }
    > = {};
    for (const spaceId of ids) {
      const state = spaceSessionService.getState(spaceId);
      access[spaceId] = {
        isUnlocked: state.isUnlocked,
        remainingMs: state.remainingMs,
        lastActivityAt: state.lastActivityAt,
      };
    }
    return { access };
  }

  async moveToBin(payload: { id: string }): Promise<{ success: boolean; purgeAt: number }> {
    const db = await getDb();
    const id = (payload.id || "").trim();
    if (!id || id === PUBLIC_SPACE_ID || id === PRIVATE_SPACE_ID) {
      throw new Error("DEFAULT_SPACE_BIN_NOT_ALLOWED");
    }
    const doc = await db.spaces.findOne(id).exec();
    if (!doc) throw new Error("SPACE_NOT_FOUND");
    const current = doc.toMutableJSON() as SpaceDocType;
    if ((current.deletedAt || 0) > 0) {
      return { success: true, purgeAt: current.purgeAt || 0 };
    }
    const now = Date.now();
    const purgeAt = computeBinPurgeAt(now);
    await doc.patch({ deletedAt: now, purgeAt, updatedAt: now });
    if (current.isPrivate) {
      try {
        spaceSessionService.lockSpace(current.id);
      } catch {}
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true, purgeAt };
  }

  async restoreFromBin(payload: {
    id: string;
  }): Promise<{ success: boolean; relocated?: boolean; message?: string }> {
    const db = await getDb();
    const id = (payload.id || "").trim();
    if (!id) return { success: false };
    const doc = await db.spaces.findOne(id).exec();
    if (!doc) throw new Error("SPACE_NOT_FOUND");
    const current = doc.toMutableJSON() as SpaceDocType;
    if ((current.deletedAt || 0) === 0) return { success: true };
    const now = Date.now();
    if (isSpacePurgeable(current, now)) {
      throw new Error("SPACE_PURGE_IN_PROGRESS");
    }
    const baseName = normalizeSpaceName(current.name || "").trim() || "Restored space";
    const existing = await db.spaces.find({ selector: { ...LIVE_SPACE_SELECTOR } }).exec();
    const existingNames = new Set(
      existing
        .map((row) => ((row.get("name") as string) || "").toLowerCase())
        .filter((value) => value !== baseName.toLowerCase())
    );
    let nextName = baseName;
    if (existingNames.has(nextName.toLowerCase())) {
      let index = 2;
      while (existingNames.has(`${baseName} (restored ${index})`.toLowerCase())) {
        index += 1;
      }
      nextName = `${baseName} (restored ${index})`;
    }
    const patch: Partial<SpaceDocType> = { deletedAt: SPACE_NOT_BINNED, purgeAt: 0, updatedAt: now };
    let relocated = false;
    if (nextName !== baseName) {
      patch.name = nextName;
      patch.slug = safeSlug(nextName, current.slug);
    }
    const originalGroupId = (current.spaceGroupId || "").trim();
    if (originalGroupId && db.space_groups?.findOne) {
      const groupDoc = await db.space_groups.findOne(originalGroupId).exec();
      if (!groupDoc) {
        patch.spaceGroupId = UNGROUPED_SPACE_GROUP_ID;
        relocated = true;
      }
    }
    await doc.patch(patch);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return {
      success: true,
      relocated,
      message: relocated
        ? "Heads up: the original space group is no longer available, so this space was restored to Ungrouped."
        : undefined,
    };
  }

  async listBinSpaces(): Promise<SpaceListItem[]> {
    const db = await getDb();
    const docs = await db.spaces
      .find({ selector: { deletedAt: { $gt: SPACE_NOT_BINNED } } })
      .exec();
    return docs
      .map((doc) => this.toListItem(doc.toMutableJSON() as SpaceDocType))
      .sort((a, b) => (a.purgeAt || 0) - (b.purgeAt || 0));
  }

  async purgeExpired(): Promise<{ purgedSpaceIds: string[] }> {
    const db = await getDb();
    const now = Date.now();
    const docs = await db.spaces
      .find({ selector: { deletedAt: { $gt: SPACE_NOT_BINNED }, purgeAt: { $lte: now } } })
      .exec();
    if (docs.length === 0) return { purgedSpaceIds: [] };

    const purgedIds: string[] = [];
    for (const doc of docs) {
      const spaceId = doc.primary as string;
      purgedIds.push(spaceId);
      await this.hardDeleteSpaceContents(spaceId);
      try {
        await doc.remove();
      } catch (removeError) {
        console.error("[Spaces] purge: failed to remove space doc", removeError);
      }
    }

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    return { purgedSpaceIds: purgedIds };
  }

  async deleteSpaceForever(payload: { id: string }): Promise<{ success: boolean; removedItems: number }> {
    const db = await getDb();
    const id = (payload.id || "").trim();
    if (!id || id === PUBLIC_SPACE_ID || id === PRIVATE_SPACE_ID) {
      throw new Error("DEFAULT_SPACE_DELETE_NOT_ALLOWED");
    }
    const doc = await db.spaces.findOne(id).exec();
    if (!doc) return { success: false, removedItems: 0 };
    const removedItems = await this.hardDeleteSpaceContents(id);
    try {
      await doc.remove();
    } catch (removeError) {
      console.error("[Spaces] hard delete: failed to remove space doc", removeError);
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    return { success: true, removedItems };
  }

  private async hardDeleteSpaceContents(spaceId: string): Promise<number> {
    const db = await getDb();
    const PURGE_BATCH = 200;
    let removedItems = 0;

    const folderDocs = await db.folders
      .find({ selector: { spaceId: { $eq: spaceId } } })
      .exec();
    if (folderDocs.length > 0) {
      for (let i = 0; i < folderDocs.length; i += PURGE_BATCH) {
        const slice = folderDocs.slice(i, i + PURGE_BATCH);
        await db.folders.bulkRemove(slice.map((doc) => doc.primary));
      }
    }

    let exhausted = false;
    while (!exhausted) {
      const itemDocs = await db.items
        .find({ selector: { spaceId: { $eq: spaceId } }, limit: PURGE_BATCH })
        .exec();
      if (itemDocs.length === 0) {
        exhausted = true;
        break;
      }
      removedItems += itemDocs.length;
      await db.items.bulkRemove(itemDocs.map((doc) => doc.primary));
    }
    return removedItems;
  }

  async reorderSpaces(payload: {
    orderedIds: string[];
    spaceGroupId?: string | null;
  }): Promise<{ success: boolean }> {
    const db = await getDb();
    const groupId =
      typeof payload.spaceGroupId === "string" && payload.spaceGroupId.trim()
        ? payload.spaceGroupId.trim()
        : null;
    const selector =
      groupId === null
        ? { ...LIVE_SPACE_SELECTOR, spaceGroupId: { $eq: UNGROUPED_SPACE_GROUP_ID } }
        : { ...LIVE_SPACE_SELECTOR, spaceGroupId: { $eq: groupId } };
    const docs = await db.spaces.find({ selector }).exec();
    const allIds = docs.map((doc) => doc.primary);
    const provided = (payload.orderedIds || []).filter((id) => id && allIds.includes(id));
    const finalOrder = appendUnorderedIds(provided, allIds);
    const now = Date.now();
    for (let i = 0; i < finalOrder.length; i += 1) {
      const id = finalOrder[i];
      const doc = await db.spaces.findOne(id).exec();
      if (!doc) continue;
      const current = doc.toMutableJSON() as SpaceDocType;
      if (current.sortOrder !== i) {
        await doc.patch({ sortOrder: i, updatedAt: now });
      }
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "spaces" });
    } catch {}
    return { success: true };
  }
}

export const spacesController = new SpacesController();
