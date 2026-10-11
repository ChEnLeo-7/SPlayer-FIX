import {
  appendSPlayerOperations,
  changeSPlayerPassword,
  getSPlayerApiErrorMessage,
  getSPlayerSession,
  getSPlayerSyncInfo,
  getSPlayerVault,
  loginSPlayerAccount,
  logoutSPlayerAccount,
  migrateSPlayerSync,
  pullSPlayerOperations,
  registerSPlayerAccount,
} from "@/api/splayerAccount";
import { sPlayerAccountKeyPlugin } from "@/platform/android/accountKeyPlugin";
import { useDataStore } from "@/stores/data";
import { useLocalStore } from "@/stores/local";
import { createDefaultSettingState, useSettingStore } from "@/stores/setting";
import { createDefaultShortcutState, useShortcutStore } from "@/stores/shortcut";
import { createDefaultStatusState, useStatusStore } from "@/stores/status";
import type {
  EncryptedVault,
  SPlayerAccountStatus,
  SPlayerEncryption,
  SPlayerPasswordEncryption,
  SPlayerSyncInfo,
  SPlayerSyncStatus,
  SPlayerUser,
  SPlayerVaultSnapshot,
  SPlayerVersionTable,
} from "@/types/account";
import {
  createEncryptedVault,
  decryptSPlayerOperation,
  decryptVault,
  deriveAuthenticationSecret,
  deriveRecoveryProof,
  deserializeAccountCryptoKey,
  encryptSPlayerOperation,
  encryptVault,
  protectRecoveryKey,
  rewrapVaultKeyWithPassword,
  serializeAccountCryptoKey,
  unlockVaultWithPassword,
  unlockVaultWithRecoveryKey,
  unprotectRecoveryKey,
} from "@/utils/accountCrypto";
import type { AccountCryptoKey } from "@/utils/accountCrypto";
import {
  deleteWebAccountDeviceKey,
  getWebAccountDeviceKey,
  saveWebAccountDeviceKey,
} from "@/utils/accountDeviceKey";
import {
  appendAccountSyncOutbox,
  clearAccountDraft,
  commitAccountSyncProgress,
  getAccountDraft,
  getAccountSyncState,
  getActiveAccountScope,
  getGuestSnapshot,
  getOrCreateAccountDeviceId,
  getPendingRegistration,
  initializeAccountSyncState,
  reserveAccountDeviceSequence,
  saveAccountDraft,
  saveGuestSnapshot,
  savePendingRegistration,
  setAccountScopeActive,
  setGuestScopeActive,
  clearPendingRegistration,
} from "@/utils/accountScope";
import type { AccountDraft } from "@/utils/accountScope";
import {
  applyPreferencesSnapshot,
  createDefaultPreferencesSnapshot,
  exportPreferencesSnapshot,
} from "@/utils/accountPreferences";
import {
  applyAccountMutations,
  applySPlayerOperations,
  createBaselineVersionTable,
  createSPlayerOperationBatches,
  createSPlayerOperationMetadata,
  diffVaultSnapshots,
} from "@/utils/accountSync";
import { isNativeAndroid } from "@/utils/env";
import axios from "axios";
import { defineStore } from "pinia";

const SYNC_DELAY = 1200;
const SYNC_POLL_INTERVAL = 45_000;
const INITIAL_RETRY_DELAY = 2_000;
const MAX_RETRY_DELAY = 60_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_PULL_SIZE = 100;

const createEmptyVault = (): SPlayerVaultSnapshot => ({
  schemaVersion: 1,
  data: {
    userLikeData: {
      songs: [],
      playlists: [],
      artists: [],
      albums: [],
      mvs: [],
      djs: [],
    },
    likeSongsList: {
      detail: {
        id: 0,
        name: "我喜欢的音乐",
        cover: "/images/album.jpg?asset",
      },
      data: [],
    },
    historyList: [],
    playList: [],
    originalPlayList: [],
  },
  local: {
    localPlaylists: [],
    playlistSongs: [],
  },
  preferences: createDefaultPreferencesSnapshot(
    createDefaultSettingState(),
    createDefaultStatusState(),
    createDefaultShortcutState(),
  ),
});

const cloneSnapshot = (snapshot: SPlayerVaultSnapshot) => structuredClone(snapshot);

export const useAccountStore = defineStore("splayer-account", () => {
  const status = ref<SPlayerAccountStatus>("guest");
  const user = ref<SPlayerUser | null>(null);
  const revision = ref(0);
  const syncStatus = ref<SPlayerSyncStatus>("idle");
  const mustChangePassword = ref(false);
  const lastError = ref("");
  const pendingRecoveryKey = ref("");
  const pendingRegistrationConfirmed = ref(false);

  let vaultKey: AccountCryptoKey | null = null;
  let encryption: SPlayerEncryption | null = null;
  let encryptedVault: EncryptedVault | null = null;
  let syncInfo: SPlayerSyncInfo | null = null;
  let materializedSnapshot: SPlayerVaultSnapshot | null = null;
  let materializedVersions: SPlayerVersionTable | null = null;
  let materializedCursor = 0;
  let legacyConflictBaseRevision: number | null = null;
  let syncSuspended = false;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryDelay = INITIAL_RETRY_DELAY;
  let eventSource: EventSource | null = null;
  let lifecycleActive = false;
  let lifecycleGeneration = 0;
  let onlineHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;
  let accountWorkQueue: Promise<void> = Promise.resolve();
  let localChangeGeneration = 0;

  const enqueueAccountWork = <T>(work: () => Promise<T>): Promise<T> => {
    const pending = accountWorkQueue.catch(() => undefined).then(work);
    accountWorkQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  const getPasswordEncryption = (nextEncryption: SPlayerEncryption): SPlayerPasswordEncryption => ({
    kdfSalt: nextEncryption.kdfSalt,
    kdfIterations: nextEncryption.kdfIterations,
    wrappedVaultKey: nextEncryption.wrappedVaultKey,
  });

  const exportSnapshot = (): SPlayerVaultSnapshot => ({
    schemaVersion: 1,
    data: useDataStore().exportAccountSnapshot(),
    local: useLocalStore().exportAccountSnapshot(),
    preferences: exportPreferencesSnapshot(
      useSettingStore().$state,
      useStatusStore().$state,
      useShortcutStore().$state,
    ),
  });

  const applySnapshot = async (snapshot: SPlayerVaultSnapshot) => {
    applyPreferencesSnapshot(
      snapshot.preferences,
      useSettingStore(),
      useStatusStore(),
      useShortcutStore().$state,
      {
        setting: createDefaultSettingState(),
        status: createDefaultStatusState(),
        shortcut: createDefaultShortcutState(),
      },
    );
    await Promise.all([
      useDataStore().applyAccountSnapshot(snapshot.data),
      useLocalStore().applyAccountSnapshot(snapshot.local),
    ]);
  };

  const applySyncedSnapshot = async (snapshot: SPlayerVaultSnapshot) => {
    syncSuspended = true;
    try {
      await applySnapshot(snapshot);
      await nextTick();
    } finally {
      syncSuspended = false;
    }
  };

  const restoreGuest = async () => {
    const guestSnapshot = await getGuestSnapshot();
    if (guestSnapshot) await applySyncedSnapshot(guestSnapshot);
    await setGuestScopeActive();
  };

  const setAuthenticated = async (accountUser: SPlayerUser, nextRevision: number) => {
    user.value = accountUser;
    revision.value = nextRevision;
    mustChangePassword.value = accountUser.mustChangePassword ?? false;
    status.value = "authenticated";
    lastError.value = "";
    await setAccountScopeActive(accountUser.id ?? accountUser.username);
  };

  const saveDeviceVaultKey = async (accountId: string | number, key: AccountCryptoKey) => {
    try {
      const serializedKey = await serializeAccountCryptoKey(key);
      if (isNativeAndroid) {
        await sPlayerAccountKeyPlugin.saveKey({ accountId: String(accountId), key: serializedKey });
      } else {
        await saveWebAccountDeviceKey(accountId, serializedKey);
      }
    } catch (error) {
      console.warn("保存账户设备密钥失败", error);
    }
  };

  const getDeviceVaultKey = async (
    accountId: string | number,
  ): Promise<AccountCryptoKey | null> => {
    try {
      const serializedKey = isNativeAndroid
        ? (await sPlayerAccountKeyPlugin.getKey({ accountId: String(accountId) })).key
        : await getWebAccountDeviceKey(accountId);
      return serializedKey ? await deserializeAccountCryptoKey(serializedKey) : null;
    } catch (error) {
      console.warn("恢复账户设备密钥失败", error);
      if (!isNativeAndroid) {
        try {
          await deleteWebAccountDeviceKey(accountId);
        } catch {
          // 忽略损坏记录清理失败
        }
      }
      return null;
    }
  };

  const deleteDeviceVaultKey = async (accountId: string | number) => {
    try {
      if (isNativeAndroid) {
        await sPlayerAccountKeyPlugin.deleteKey({ accountId: String(accountId) });
      } else {
        await deleteWebAccountDeviceKey(accountId);
      }
    } catch (error) {
      console.warn("删除账户设备密钥失败", error);
    }
  };

  const stopSyncLifecycle = () => {
    lifecycleActive = false;
    lifecycleGeneration += 1;
    eventSource?.close();
    eventSource = null;
    if (syncTimer) clearTimeout(syncTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (pollTimer) clearInterval(pollTimer);
    syncTimer = null;
    retryTimer = null;
    pollTimer = null;
    if (onlineHandler) window.removeEventListener("online", onlineHandler);
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
    onlineHandler = null;
    visibilityHandler = null;
  };

  const resetToGuest = () => {
    stopSyncLifecycle();
    vaultKey = null;
    encryption = null;
    encryptedVault = null;
    syncInfo = null;
    materializedSnapshot = null;
    materializedVersions = null;
    materializedCursor = 0;
    legacyConflictBaseRevision = null;
    user.value = null;
    revision.value = 0;
    status.value = "guest";
    syncStatus.value = "idle";
    mustChangePassword.value = false;
    lastError.value = "";
    pendingRecoveryKey.value = "";
    pendingRegistrationConfirmed.value = false;
  };

  const decryptOperations = async (
    accountId: string | number,
    operations: Awaited<ReturnType<typeof pullSPlayerOperations>>["operations"],
    key: AccountCryptoKey,
  ) =>
    Promise.all(
      operations.map(async (operation) => ({
        metadata: {
          operationId: operation.operationId,
          deviceId: operation.deviceId,
          deviceSeq: operation.deviceSeq,
          baseCursor: operation.baseCursor,
        },
        payload: await decryptSPlayerOperation(accountId, operation, key),
        cursor: operation.cursor,
      })),
    );

  const rebuildFromBaseline = async (
    accountId: string | number,
    baseline: SPlayerVaultSnapshot,
    key: AccountCryptoKey,
    info: SPlayerSyncInfo,
  ) => {
    const localState = await getAccountSyncState(accountId);
    const outboxIds = new Set(localState.outbox.map((operation) => operation.operationId));
    const acknowledgedOperationIds = new Set<string>();
    let cursor = 0;
    let snapshot = cloneSnapshot(baseline);
    let versions = createBaselineVersionTable(baseline, 0);

    while (true) {
      const page = await pullSPlayerOperations({
        after: cursor,
        limit: info.limits.maxPullOperations || DEFAULT_PULL_SIZE,
      });
      if (page.operations.length === 0 && cursor < page.headCursor) {
        throw new Error("服务端同步游标不连续");
      }
      const decrypted = await decryptOperations(accountId, page.operations, key);
      const result = applySPlayerOperations(snapshot, versions, decrypted);
      snapshot = result.snapshot;
      versions = result.versions;
      for (const operation of page.operations) {
        if (outboxIds.has(operation.operationId)) {
          acknowledgedOperationIds.add(operation.operationId);
        }
      }
      cursor = page.nextCursor;
      if (!page.hasMore && cursor >= page.headCursor) break;
      if (page.operations.length === 0) throw new Error("服务端同步游标不连续");
    }

    const pendingOperations = await Promise.all(
      localState.outbox
        .filter((operation) => !acknowledgedOperationIds.has(operation.operationId))
        .map(async (operation) => ({
          metadata: {
            operationId: operation.operationId,
            deviceId: operation.deviceId,
            deviceSeq: operation.deviceSeq,
            baseCursor: operation.baseCursor,
          },
          payload: await decryptSPlayerOperation(accountId, operation, key),
        })),
    );
    const withPending = applySPlayerOperations(snapshot, versions, pendingOperations);
    return {
      ...withPending,
      cursor,
      acknowledgedOperationIds: [...acknowledgedOperationIds],
    };
  };

  const stageMutations = async (
    accountId: string | number,
    mutations: ReturnType<typeof diffVaultSnapshots>,
    baseCursor?: number,
  ) => {
    if (!vaultKey || !materializedSnapshot || !materializedVersions || mutations.length === 0) {
      return;
    }
    const deviceId = await getOrCreateAccountDeviceId();
    const deviceSeq = await reserveAccountDeviceSequence(accountId);
    const metadata = createSPlayerOperationMetadata(
      deviceId,
      deviceSeq,
      baseCursor ?? materializedCursor,
    );
    const operation = await encryptSPlayerOperation(
      accountId,
      { schemaVersion: 1, mutations },
      metadata,
      vaultKey,
    );
    const result = applyAccountMutations(
      materializedSnapshot,
      materializedVersions,
      mutations,
      metadata,
    );
    await appendAccountSyncOutbox(accountId, operation, result.versions);
    materializedSnapshot = result.snapshot;
    materializedVersions = result.versions;
    syncStatus.value = "pending";
  };

  const stageSnapshot = async (snapshot: SPlayerVaultSnapshot) => {
    if (status.value !== "authenticated" || !user.value || !materializedSnapshot) return;
    const mutations = diffVaultSnapshots(materializedSnapshot, snapshot);
    await stageMutations(user.value.id ?? user.value.username, mutations);
  };

  const stageLegacyDraft = async (
    accountId: string | number,
    baseline: SPlayerVaultSnapshot,
    draft: AccountDraft,
    key: AccountCryptoKey,
    forceLocal: boolean,
  ) => {
    const draftSnapshot = await decryptVault(draft.vault, key);
    const source = forceLocal && materializedSnapshot ? materializedSnapshot : baseline;
    await stageMutations(
      accountId,
      diffVaultSnapshots(source, draftSnapshot),
      forceLocal ? materializedCursor : 0,
    );
    await clearAccountDraft(accountId);
  };

  const activateWithVaultKey = async (
    accountUser: SPlayerUser,
    nextRevision: number,
    nextVault: EncryptedVault,
    unlockedKey: AccountCryptoKey,
    selectedDraft?: AccountDraft | null,
  ) => {
    stopSyncLifecycle();
    const accountId = accountUser.id ?? accountUser.username;
    const draft = selectedDraft === undefined ? await getAccountDraft(accountId) : selectedDraft;
    const baseline = await decryptVault(nextVault, unlockedKey);
    const infoResponse = await getSPlayerSyncInfo();
    const forceDraft = selectedDraft !== undefined && selectedDraft !== null;

    vaultKey = unlockedKey;
    encryptedVault = nextVault;
    syncInfo = infoResponse.sync;
    await setAccountScopeActive(accountId);

    if (draft && draft.baseRevision !== nextRevision && !forceDraft) {
      const draftSnapshot = await decryptVault(draft.vault, unlockedKey);
      await applySyncedSnapshot(draftSnapshot);
      materializedSnapshot = cloneSnapshot(draftSnapshot);
      materializedVersions = null;
      materializedCursor = 0;
      legacyConflictBaseRevision = draft.baseRevision;
      await setAuthenticated(accountUser, nextRevision);
      syncStatus.value = "conflict";
      lastError.value = "本机旧草稿与云端保险库均有更新，请选择保留哪一份";
      return;
    }

    if (syncInfo.mode === "vault") {
      syncInfo = (await migrateSPlayerSync({ revision: nextRevision })).sync;
      await initializeAccountSyncState(
        accountId,
        syncInfo.headCursor,
        createBaselineVersionTable(baseline, syncInfo.headCursor),
      );
    }

    const rebuilt = await rebuildFromBaseline(accountId, baseline, unlockedKey, syncInfo);
    await applySyncedSnapshot(rebuilt.snapshot);
    materializedSnapshot = cloneSnapshot(rebuilt.snapshot);
    materializedVersions = rebuilt.versions;
    materializedCursor = rebuilt.cursor;
    await commitAccountSyncProgress(
      accountId,
      rebuilt.cursor,
      rebuilt.versions,
      rebuilt.acknowledgedOperationIds,
    );

    if (draft) {
      await stageLegacyDraft(accountId, baseline, draft, unlockedKey, forceDraft);
      if (materializedSnapshot) await applySyncedSnapshot(materializedSnapshot);
    }

    legacyConflictBaseRevision = null;
    await setAuthenticated(accountUser, nextRevision);
    const state = await getAccountSyncState(accountId);
    syncStatus.value = state.outbox.length > 0 ? "pending" : "synced";
    startSyncLifecycle();
    if (!baseline.preferences) scheduleSync();
    if (state.outbox.length > 0) void syncNow().catch(() => undefined);
  };

  const register = async (username: string, password: string): Promise<string> => {
    await saveGuestSnapshot(exportSnapshot());
    const emptyVault = createEmptyVault();
    const encrypted = await createEncryptedVault(password, emptyVault);
    const authSecret = await deriveAuthenticationSecret(username, password);
    // 请求前保留恢复密钥，避免响应丢失后无法恢复。
    pendingRecoveryKey.value = encrypted.recoveryKey;
    pendingRegistrationConfirmed.value = false;
    await savePendingRegistration({
      username: username.normalize("NFKC").trim().toLocaleLowerCase("und"),
      protectedRecoveryKey: await protectRecoveryKey(password, encrypted.recoveryKey),
    });
    const response = await registerSPlayerAccount({
      username,
      authSecret,
      recoveryVerifier: encrypted.recoveryVerifier,
      encryption: encrypted.encryption,
      vault: encrypted.vault,
    });
    pendingRegistrationConfirmed.value = true;
    encryption = response.encryption;
    await activateWithVaultKey(
      response.user,
      response.revision,
      response.vault,
      encrypted.vaultKey,
    );
    await saveDeviceVaultKey(response.user.id ?? response.user.username, encrypted.vaultKey);
    return pendingRecoveryKey.value;
  };

  const login = async (
    username: string,
    password: string,
  ): Promise<"authenticated" | "authenticated-with-recovery" | "recovery"> => {
    await saveGuestSnapshot(exportSnapshot());
    const authSecret = await deriveAuthenticationSecret(username, password);
    const response = await loginSPlayerAccount({ username, authSecret });
    encryption = response.encryption;
    encryptedVault = response.vault;
    syncInfo = (await getSPlayerSyncInfo()).sync;
    if (response.user.mustChangePassword) {
      vaultKey = null;
      user.value = response.user;
      revision.value = response.revision;
      status.value = "locked";
      syncStatus.value = "idle";
      mustChangePassword.value = true;
      lastError.value = "需要恢复密钥设置新密码";
      return "recovery";
    }
    const unlockedKey = await unlockVaultWithPassword(password, response.encryption);
    await activateWithVaultKey(response.user, response.revision, response.vault, unlockedKey);
    await saveDeviceVaultKey(response.user.id ?? response.user.username, unlockedKey);
    const pendingRegistration = await getPendingRegistration();
    const normalizedUsername = username.normalize("NFKC").trim().toLocaleLowerCase("und");
    if (pendingRegistration?.username === normalizedUsername) {
      try {
        pendingRecoveryKey.value = await unprotectRecoveryKey(
          password,
          pendingRegistration.protectedRecoveryKey,
        );
        pendingRegistrationConfirmed.value = true;
        return "authenticated-with-recovery";
      } catch {
        // 密码被重置后，待确认材料不再可用。
      }
    }
    return "authenticated";
  };

  const recoverPassword = async (
    currentPassword: string,
    recoveryKey: string,
    newPassword: string,
  ): Promise<void> => {
    if (
      status.value !== "locked" ||
      !mustChangePassword.value ||
      !user.value ||
      !encryption ||
      !encryptedVault
    ) {
      throw new Error("当前账户不需要恢复密码");
    }
    const unlockedKey = await unlockVaultWithRecoveryKey(recoveryKey, encryption);
    await decryptVault(encryptedVault, unlockedKey);
    const nextEncryption = await rewrapVaultKeyWithPassword(newPassword, unlockedKey, encryption);
    const response = await changeSPlayerPassword({
      currentAuthSecret: await deriveAuthenticationSecret(user.value.username, currentPassword),
      newAuthSecret: await deriveAuthenticationSecret(user.value.username, newPassword),
      passwordEncryption: getPasswordEncryption(nextEncryption),
      recoveryProof: await deriveRecoveryProof(recoveryKey),
    });
    encryption = response.encryption;
    encryptedVault = response.vault;
    await activateWithVaultKey(response.user, response.revision, response.vault, unlockedKey);
    await saveDeviceVaultKey(response.user.id ?? response.user.username, unlockedKey);
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
    if (status.value !== "authenticated" || !user.value || !encryption || !encryptedVault) {
      throw new Error("请先解锁 SPlayer 账户");
    }
    const unlockedKey = await unlockVaultWithPassword(currentPassword, encryption);
    await decryptVault(encryptedVault, unlockedKey);
    const nextEncryption = await rewrapVaultKeyWithPassword(newPassword, unlockedKey, encryption);
    const response = await changeSPlayerPassword({
      currentAuthSecret: await deriveAuthenticationSecret(user.value.username, currentPassword),
      newAuthSecret: await deriveAuthenticationSecret(user.value.username, newPassword),
      passwordEncryption: getPasswordEncryption(nextEncryption),
    });
    vaultKey = unlockedKey;
    encryption = response.encryption;
    encryptedVault = response.vault;
    user.value = response.user;
    revision.value = response.revision;
    mustChangePassword.value = response.user.mustChangePassword ?? false;
    await saveDeviceVaultKey(response.user.id ?? response.user.username, unlockedKey);
  };

  const restoreSession = async (): Promise<void> => {
    stopSyncLifecycle();
    const activeScope = await getActiveAccountScope();
    if (activeScope?.startsWith("account:")) await restoreGuest();
    if (!activeScope) {
      await saveGuestSnapshot(exportSnapshot());
      await setGuestScopeActive();
    }

    try {
      const session = await getSPlayerSession();
      if (!session.user) {
        resetToGuest();
        return;
      }
      syncInfo = (await getSPlayerSyncInfo()).sync;
      vaultKey = null;
      encryption = session.encryption ?? null;
      encryptedVault = session.vault ?? null;
      user.value = session.user;
      revision.value = session.revision ?? 0;
      mustChangePassword.value = session.user.mustChangePassword ?? false;
      if (!mustChangePassword.value) {
        const accountId = session.user.id ?? session.user.username;
        const deviceKey = await getDeviceVaultKey(accountId);
        if (deviceKey && session.vault) {
          try {
            await decryptVault(session.vault, deviceKey);
          } catch (error) {
            console.warn("账户设备密钥无法解锁保险库", error);
            await deleteDeviceVaultKey(accountId);
            status.value = "locked";
            syncStatus.value = "idle";
            lastError.value = "需要输入密码解锁此设备上的账户数据";
            return;
          }
          try {
            await activateWithVaultKey(
              session.user,
              session.revision ?? 0,
              session.vault,
              deviceKey,
            );
            return;
          } catch (error) {
            console.warn("恢复账户增量同步失败", error);
            vaultKey = null;
            status.value = "locked";
            syncStatus.value = "pending";
            lastError.value = "账户同步暂时不可用，请稍后重新解锁";
            return;
          }
        }
      }
      status.value = "locked";
      syncStatus.value = "idle";
      lastError.value = mustChangePassword.value
        ? "需要恢复密钥设置新密码"
        : "需要输入密码解锁此设备上的账户数据";
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        resetToGuest();
        return;
      }
      resetToGuest();
      lastError.value = "无法检查 SPlayer 账户会话";
    }
  };

  const isRetryableSyncError = (error: unknown) => {
    if (!axios.isAxiosError(error)) return false;
    const responseStatus = error.response?.status;
    return (
      !responseStatus || responseStatus === 408 || responseStatus === 429 || responseStatus >= 500
    );
  };

  const resetRetryBackoff = () => {
    retryDelay = INITIAL_RETRY_DELAY;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    if (!lifecycleActive || retryTimer || status.value !== "authenticated") return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connectEventSource();
      void syncNow().catch(() => undefined);
    }, delay);
  };

  const performSync = async () => {
    if (status.value !== "authenticated" || !vaultKey || !user.value || !syncInfo) return;
    const accountId = user.value.id ?? user.value.username;
    syncStatus.value = "syncing";
    lastError.value = "";

    let state = await getAccountSyncState(accountId);
    const syncGeneration = localChangeGeneration;
    const batchSize = syncInfo.limits.maxBatchOperations || DEFAULT_BATCH_SIZE;
    for (const operations of createSPlayerOperationBatches(state.outbox, batchSize)) {
      await appendSPlayerOperations({ operations });
    }

    state = await getAccountSyncState(accountId);
    const outboxIds = new Set(state.outbox.map((operation) => operation.operationId));
    const acknowledgedOperationIds = new Set<string>();
    let cursor = materializedCursor;
    const pulledOperations: Awaited<ReturnType<typeof decryptOperations>> = [];

    while (true) {
      const page = await pullSPlayerOperations({
        after: cursor,
        limit: syncInfo.limits.maxPullOperations || DEFAULT_PULL_SIZE,
      });
      if (page.operations.length > 0) {
        const decrypted = await decryptOperations(accountId, page.operations, vaultKey);
        pulledOperations.push(...decrypted);
        for (const operation of page.operations) {
          if (outboxIds.has(operation.operationId)) {
            acknowledgedOperationIds.add(operation.operationId);
          }
        }
      }
      cursor = page.nextCursor;
      if (!page.hasMore && cursor >= page.headCursor) break;
      if (page.operations.length === 0) throw new Error("服务端同步游标不连续");
    }

    if (localChangeGeneration !== syncGeneration) await stageSnapshot(exportSnapshot());
    const result = applySPlayerOperations(
      materializedSnapshot ?? exportSnapshot(),
      materializedVersions ?? {},
      pulledOperations,
    );
    const snapshot = result.snapshot;
    const versions: SPlayerVersionTable = result.versions;
    if (pulledOperations.length > 0) await applySyncedSnapshot(snapshot);
    materializedSnapshot = cloneSnapshot(snapshot);
    materializedVersions = versions;
    materializedCursor = cursor;
    await commitAccountSyncProgress(accountId, cursor, versions, [...acknowledgedOperationIds]);
    const committed = await getAccountSyncState(accountId);
    syncStatus.value = committed.outbox.length > 0 ? "pending" : "synced";
    lastError.value = "";
    resetRetryBackoff();
  };

  const syncNow = (): Promise<void> => {
    if (status.value !== "authenticated" || !vaultKey || !user.value) return Promise.resolve();
    if (syncStatus.value === "conflict") {
      return Promise.reject(new Error("请先处理本机旧草稿冲突"));
    }
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    return enqueueAccountWork(async () => {
      if (status.value !== "authenticated" || !vaultKey || !user.value) return;
      try {
        await stageSnapshot(exportSnapshot());
        await performSync();
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          stopSyncLifecycle();
          status.value = "locked";
          syncStatus.value = "pending";
          lastError.value = "登录状态已失效，请重新登录";
        } else if (isRetryableSyncError(error)) {
          syncStatus.value = "pending";
          lastError.value = "网络不可用，账户更改将在恢复连接后同步";
          scheduleRetry();
        } else {
          syncStatus.value = "error";
          lastError.value = getSPlayerApiErrorMessage(error) ?? "账户数据同步失败";
        }
        throw error;
      }
    });
  };

  const scheduleSync = () => {
    if (syncSuspended || status.value !== "authenticated" || !vaultKey || !user.value) return;
    localChangeGeneration += 1;
    if (syncStatus.value === "conflict") {
      const snapshot = exportSnapshot();
      const accountId = user.value.id ?? user.value.username;
      const baseRevision = legacyConflictBaseRevision ?? revision.value;
      void enqueueAccountWork(async () => {
        if (!vaultKey) return;
        await saveAccountDraft(accountId, {
          baseRevision,
          generation: Date.now(),
          vault: await encryptVault(snapshot, vaultKey),
        });
        materializedSnapshot = cloneSnapshot(snapshot);
      });
      return;
    }
    syncStatus.value = "pending";
    void enqueueAccountWork(() => stageSnapshot(exportSnapshot()));
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncNow().catch(() => undefined);
    }, SYNC_DELAY);
  };

  const connectEventSource = async () => {
    if (!lifecycleActive || status.value !== "authenticated" || !syncInfo) return;
    const generation = lifecycleGeneration;
    const accountId = user.value?.id ?? user.value?.username;
    if (accountId == null) return;
    if (!lifecycleActive || generation !== lifecycleGeneration || eventSource) return;
    const source = new EventSource(`/api/splayer/sync/events?cursor=${materializedCursor}`, {
      withCredentials: true,
    });
    eventSource = source;
    source.onopen = () => {
      resetRetryBackoff();
      void syncNow().catch(() => undefined);
    };
    source.addEventListener("cursor", (event) => {
      try {
        const payload = JSON.parse(event.data) as { cursor?: unknown };
        if (typeof payload.cursor === "number" && payload.cursor > materializedCursor) {
          void syncNow().catch(() => undefined);
        }
      } catch {
        // 忽略格式错误的游标通知
      }
    });
    source.onerror = () => {
      source.close();
      if (eventSource === source) eventSource = null;
      scheduleRetry();
    };
  };

  const startSyncLifecycle = () => {
    stopSyncLifecycle();
    lifecycleActive = true;
    const generation = lifecycleGeneration;
    onlineHandler = () => {
      if (generation !== lifecycleGeneration) return;
      resetRetryBackoff();
      void connectEventSource();
      void syncNow().catch(() => undefined);
    };
    visibilityHandler = () => {
      if (generation !== lifecycleGeneration || document.visibilityState !== "visible") return;
      void connectEventSource();
      void syncNow().catch(() => undefined);
    };
    window.addEventListener("online", onlineHandler);
    document.addEventListener("visibilitychange", visibilityHandler);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void syncNow().catch(() => undefined);
      }
    }, SYNC_POLL_INTERVAL);
    void connectEventSource();
  };

  const resolveConflict = async (strategy: "remote" | "local"): Promise<void> => {
    if (syncStatus.value !== "conflict" || !vaultKey || !user.value) {
      throw new Error("当前没有需要处理的旧草稿冲突");
    }
    return enqueueAccountWork(async () => {
      if (!vaultKey || !user.value) throw new Error("账户已锁定");
      const accountUser = user.value;
      const accountId = accountUser.id ?? accountUser.username;
      const key = vaultKey;
      const draft = await getAccountDraft(accountId);
      if (!draft) throw new Error("本机旧草稿已不存在");
      syncStatus.value = "syncing";
      try {
        const remote = await getSPlayerVault();
        if (strategy === "remote") {
          await clearAccountDraft(accountId);
          await activateWithVaultKey(accountUser, remote.revision, remote.vault, key, null);
        } else {
          await activateWithVaultKey(accountUser, remote.revision, remote.vault, key, draft);
        }
      } catch (error) {
        syncStatus.value = "conflict";
        lastError.value = getSPlayerApiErrorMessage(error) ?? "处理旧草稿冲突失败";
        throw error;
      }
    });
  };

  const acknowledgeRecoveryKey = () => {
    pendingRecoveryKey.value = "";
    pendingRegistrationConfirmed.value = false;
    void clearPendingRegistration();
  };

  const logout = async (): Promise<void> => {
    const accountId = user.value?.id ?? user.value?.username;
    if (status.value === "authenticated") await syncNow();
    await logoutSPlayerAccount();
    stopSyncLifecycle();
    if (accountId != null) await deleteDeviceVaultKey(accountId);
    await accountWorkQueue;
    syncSuspended = true;
    resetToGuest();
    try {
      await restoreGuest();
    } finally {
      syncSuspended = false;
    }
  };

  return {
    status,
    user,
    revision,
    syncStatus,
    mustChangePassword,
    lastError,
    pendingRecoveryKey,
    pendingRegistrationConfirmed,
    register,
    login,
    recoverPassword,
    changePassword,
    logout,
    restoreSession,
    syncNow,
    scheduleSync,
    resolveConflict,
    acknowledgeRecoveryKey,
    disposeSyncLifecycle: stopSyncLifecycle,
  };
});
