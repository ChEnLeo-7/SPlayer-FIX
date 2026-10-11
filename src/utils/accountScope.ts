import type {
  EncryptedSPlayerOperation,
  EncryptedVault,
  SPlayerLocalSyncState,
  SPlayerVaultSnapshot,
  SPlayerVersionTable,
} from "@/types/account";
import type { ProtectedRecoveryKey } from "@/utils/accountCrypto";
import localforage from "localforage";

const scopeDB = localforage.createInstance({
  name: "splayer-account-scopes",
  description: "SPlayer 账户作用域快照",
  storeName: "scopes",
});

const GUEST_SNAPSHOT_KEY = "guest-snapshot";
const ACTIVE_SCOPE_KEY = "active-scope";
const DEVICE_ID_KEY = "sync-device-id";
const syncStateUpdates = new Map<string, Promise<unknown>>();
let deviceIdPromise: Promise<string> | undefined;

const createEmptySyncState = (): SPlayerLocalSyncState => ({
  schemaVersion: 1,
  deviceSeq: 0,
  pullCursor: 0,
  outbox: [],
  versions: {},
});

const createDeviceId = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const updateAccountSyncState = <T>(
  userId: number | string,
  update: (state: SPlayerLocalSyncState) => T | Promise<T>,
): Promise<T> => {
  const key = String(userId);
  const previous = syncStateUpdates.get(key) ?? Promise.resolve();
  const pending = previous
    .catch(() => undefined)
    .then(() => {
      const runUpdate = async () => {
        const state = await getAccountSyncState(userId);
        const result = await update(state);
        await saveAccountSyncState(userId, state);
        return result;
      };
      const lockManager = globalThis.navigator?.locks;
      if (lockManager) {
        return lockManager.request(`splayer-account-sync:${key}`, runUpdate);
      }
      return runUpdate();
    });
  syncStateUpdates.set(key, pending);
  void pending
    .finally(() => {
      if (syncStateUpdates.get(key) === pending) syncStateUpdates.delete(key);
    })
    .catch(() => undefined);
  return pending;
};

export interface AccountDraft {
  baseRevision: number;
  generation: number;
  vault: EncryptedVault;
}

export interface PendingRegistration {
  username: string;
  protectedRecoveryKey: ProtectedRecoveryKey;
}

export const getGuestSnapshot = () => scopeDB.getItem<SPlayerVaultSnapshot>(GUEST_SNAPSHOT_KEY);

export const saveGuestSnapshot = async (snapshot: SPlayerVaultSnapshot) => {
  await scopeDB.setItem(GUEST_SNAPSHOT_KEY, snapshot);
};

export const getAccountDraft = (userId: number | string) =>
  scopeDB.getItem<AccountDraft>(`account:${userId}:draft`);

export const saveAccountDraft = (userId: number | string, draft: AccountDraft) =>
  scopeDB.setItem(`account:${userId}:draft`, draft);

export const clearAccountDraft = (userId: number | string) =>
  scopeDB.removeItem(`account:${userId}:draft`);

export const getPendingRegistration = () =>
  scopeDB.getItem<PendingRegistration>("pending-registration");

export const savePendingRegistration = (registration: PendingRegistration) =>
  scopeDB.setItem("pending-registration", registration);

export const clearPendingRegistration = () => scopeDB.removeItem("pending-registration");

export const getActiveAccountScope = () => scopeDB.getItem<string>(ACTIVE_SCOPE_KEY);

/** 获取启动时需要恢复的 Guest 快照 */
export const getStartupGuestSnapshot = async () => {
  const activeScope = await getActiveAccountScope();
  if (!activeScope?.startsWith("account:")) return null;
  return getGuestSnapshot();
};

export const setGuestScopeActive = () => scopeDB.setItem(ACTIVE_SCOPE_KEY, "guest");

export const setAccountScopeActive = (userId: number | string) =>
  scopeDB.setItem(ACTIVE_SCOPE_KEY, `account:${userId}`);

export const getOrCreateAccountDeviceId = async (): Promise<string> => {
  deviceIdPromise ??= (async () => {
    const existing = await scopeDB.getItem<string>(DEVICE_ID_KEY);
    if (existing) return existing;
    const deviceId = createDeviceId();
    await scopeDB.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
  })();
  return deviceIdPromise;
};

export const getAccountSyncState = async (
  userId: number | string,
): Promise<SPlayerLocalSyncState> =>
  (await scopeDB.getItem<SPlayerLocalSyncState>(`account:${userId}:sync`)) ??
  createEmptySyncState();

export const saveAccountSyncState = (userId: number | string, state: SPlayerLocalSyncState) =>
  scopeDB.setItem(`account:${userId}:sync`, state);

export const initializeAccountSyncState = (
  userId: number | string,
  pullCursor: number,
  versions: SPlayerVersionTable,
) =>
  updateAccountSyncState(userId, (state) => {
    if (state.outbox.length > 0 || Object.keys(state.versions).length > 0) return;
    state.pullCursor = pullCursor;
    state.versions = versions;
  });

export const reserveAccountDeviceSequence = async (userId: number | string): Promise<number> => {
  return updateAccountSyncState(userId, (state) => {
    state.deviceSeq += 1;
    return state.deviceSeq;
  });
};

export const appendAccountSyncOutbox = async (
  userId: number | string,
  operation: EncryptedSPlayerOperation,
  versions: SPlayerVersionTable,
) => {
  await updateAccountSyncState(userId, (state) => {
    if (!state.outbox.some((item) => item.operationId === operation.operationId)) {
      state.outbox.push(operation);
    }
    state.versions = versions;
  });
};

export const commitAccountSyncProgress = async (
  userId: number | string,
  pullCursor: number,
  versions: SPlayerVersionTable,
  acknowledgedOperationIds: readonly string[] = [],
) => {
  await updateAccountSyncState(userId, (state) => {
    const acknowledged = new Set(acknowledgedOperationIds);
    state.pullCursor = Math.max(state.pullCursor, pullCursor);
    state.versions = versions;
    state.outbox = state.outbox.filter((item) => !acknowledged.has(item.operationId));
  });
};

export const clearAccountSyncState = (userId: number | string) =>
  scopeDB.removeItem(`account:${userId}:sync`);
