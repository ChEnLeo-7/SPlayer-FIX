import {
  changeSPlayerPassword,
  getSPlayerVault,
  getSPlayerSession,
  getSPlayerApiErrorMessage,
  loginSPlayerAccount,
  logoutSPlayerAccount,
  registerSPlayerAccount,
  updateSPlayerVault,
} from "@/api/splayerAccount";
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
  SPlayerSyncStatus,
  SPlayerUser,
  SPlayerVaultSnapshot,
} from "@/types/account";
import {
  createEncryptedVault,
  deriveAuthenticationSecret,
  deriveRecoveryProof,
  decryptVault,
  encryptVault,
  protectRecoveryKey,
  rewrapVaultKeyWithPassword,
  unlockVaultWithRecoveryKey,
  unlockVaultWithPassword,
  unprotectRecoveryKey,
} from "@/utils/accountCrypto";
import type { AccountCryptoKey } from "@/utils/accountCrypto";
import {
  applyPreferencesSnapshot,
  createDefaultPreferencesSnapshot,
  exportPreferencesSnapshot,
} from "@/utils/accountPreferences";
import {
  getActiveAccountScope,
  getAccountDraft,
  getGuestSnapshot,
  getPendingRegistration,
  clearAccountDraft,
  clearPendingRegistration,
  saveAccountDraft,
  saveGuestSnapshot,
  savePendingRegistration,
  setAccountScopeActive,
  setGuestScopeActive,
} from "@/utils/accountScope";
import axios from "axios";
import { defineStore } from "pinia";

const SYNC_DELAY = 1200;

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
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let draftWriteQueue: Promise<void> = Promise.resolve();
  let syncSuspended = false;
  let dataGeneration = 0;

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

  const restoreGuest = async () => {
    const guestSnapshot = await getGuestSnapshot();
    if (guestSnapshot) await applySnapshot(guestSnapshot);
    await setGuestScopeActive();
  };

  const setAuthenticated = async (accountUser: SPlayerUser, nextRevision: number) => {
    user.value = accountUser;
    revision.value = nextRevision;
    mustChangePassword.value = accountUser.mustChangePassword ?? false;
    status.value = "authenticated";
    syncStatus.value = "synced";
    lastError.value = "";
    await setAccountScopeActive(accountUser.id ?? accountUser.username);
  };

  const resetToGuest = () => {
    vaultKey = null;
    encryption = null;
    encryptedVault = null;
    user.value = null;
    revision.value = 0;
    status.value = "guest";
    syncStatus.value = "idle";
    mustChangePassword.value = false;
    lastError.value = "";
    pendingRecoveryKey.value = "";
    pendingRegistrationConfirmed.value = false;
  };

  const register = async (username: string, password: string): Promise<string> => {
    await saveGuestSnapshot(exportSnapshot());
    const emptyVault = createEmptyVault();
    const encrypted = await createEncryptedVault(password, emptyVault);
    const authSecret = await deriveAuthenticationSecret(username, password);
    // 请求前保留恢复密钥，避免服务端已创建账户但响应丢失时无法恢复。
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
    await setAccountScopeActive(response.user.id ?? response.user.username);
    try {
      await applySnapshot(emptyVault);
    } catch (error) {
      await restoreGuest();
      throw error;
    }
    vaultKey = encrypted.vaultKey;
    encryption = response.encryption;
    encryptedVault = response.vault;
    await setAuthenticated(response.user, response.revision);
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
    const accountId = response.user.id ?? response.user.username;
    const draft = await getAccountDraft(accountId);
    const snapshot = draft
      ? await decryptVault(draft.vault, unlockedKey)
      : await decryptVault(response.vault, unlockedKey);
    await setAccountScopeActive(response.user.id ?? response.user.username);
    try {
      await applySnapshot(snapshot);
    } catch (error) {
      await restoreGuest();
      throw error;
    }
    vaultKey = unlockedKey;
    await setAuthenticated(response.user, response.revision);
    if (!snapshot.preferences) scheduleSync();
    if (draft) {
      syncStatus.value = draft.baseRevision === response.revision ? "idle" : "conflict";
      lastError.value =
        draft.baseRevision === response.revision
          ? "存在尚未上传的本机账户数据"
          : "本机草稿与云端版本均有更新，请选择保留哪一份";
      if (draft.baseRevision === response.revision) scheduleSync();
    }
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
        // 密码已被管理员重置时，待确认材料不再可用。
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
    const snapshot = await decryptVault(response.vault, unlockedKey);
    encryption = response.encryption;
    encryptedVault = response.vault;
    await setAccountScopeActive(response.user.id ?? response.user.username);
    try {
      await applySnapshot(snapshot);
    } catch (error) {
      await restoreGuest();
      throw error;
    }
    vaultKey = unlockedKey;
    await setAuthenticated(response.user, response.revision);
    if (!snapshot.preferences) scheduleSync();
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
    await setAuthenticated(response.user, response.revision);
  };

  const restoreSession = async (): Promise<void> => {
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
      vaultKey = null;
      encryption = session.encryption ?? null;
      encryptedVault = session.vault ?? null;
      user.value = session.user;
      revision.value = session.revision ?? 0;
      status.value = "locked";
      syncStatus.value = "idle";
      mustChangePassword.value = session.user.mustChangePassword ?? false;
      lastError.value = "需要输入密码解锁此设备上的账户数据";
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        resetToGuest();
        return;
      }
      resetToGuest();
      lastError.value = "无法检查 SPlayer 账户会话";
    }
  };

  const syncNow = async (): Promise<void> => {
    if (status.value !== "authenticated" || !vaultKey || !user.value) return;
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    const accountId = user.value.id ?? user.value.username;
    syncStatus.value = "syncing";
    lastError.value = "";
    try {
      await draftWriteQueue;
      const syncGeneration = dataGeneration;
      const snapshot = exportSnapshot();
      const vault = await encryptVault(snapshot, vaultKey);
      await saveAccountDraft(accountId, {
        baseRevision: revision.value,
        generation: syncGeneration,
        vault,
      });
      const response = await updateSPlayerVault({ revision: revision.value, vault });
      revision.value = response.revision;
      encryptedVault = response.vault;
      syncStatus.value = "synced";
      if (dataGeneration === syncGeneration) await clearAccountDraft(accountId);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        syncStatus.value = "conflict";
        lastError.value = "云端数据已在其他设备更新，本地数据未被覆盖";
      } else {
        syncStatus.value = "error";
        lastError.value = getSPlayerApiErrorMessage(error) ?? "账户数据同步失败";
      }
      throw error;
    }
  };

  const persistEncryptedDraft = () => {
    if (syncSuspended || status.value !== "authenticated" || !vaultKey || !user.value) {
      return draftWriteQueue;
    }
    const currentKey = vaultKey;
    const accountId = user.value.id ?? user.value.username;
    const baseRevision = revision.value;
    const generation = dataGeneration;
    const snapshot = exportSnapshot();
    draftWriteQueue = draftWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const vault = await encryptVault(snapshot, currentKey);
        await saveAccountDraft(accountId, { baseRevision, generation, vault });
      });
    return draftWriteQueue;
  };

  const scheduleSync = () => {
    if (syncSuspended || status.value !== "authenticated" || !vaultKey) return;
    dataGeneration += 1;
    if (syncTimer) clearTimeout(syncTimer);
    void persistEncryptedDraft().catch(() => undefined);
    if (syncStatus.value === "conflict") return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncNow().catch(() => undefined);
    }, SYNC_DELAY);
  };

  const resolveConflict = async (strategy: "remote" | "local"): Promise<void> => {
    if (syncStatus.value !== "conflict" || !vaultKey || !user.value) {
      throw new Error("当前没有需要处理的同步冲突");
    }
    syncStatus.value = "syncing";
    try {
      const remote = await getSPlayerVault();
      if (strategy === "remote") {
        const snapshot = await decryptVault(remote.vault, vaultKey);
        syncSuspended = true;
        try {
          await applySnapshot(snapshot);
        } finally {
          syncSuspended = false;
        }
        revision.value = remote.revision;
        encryptedVault = remote.vault;
        syncStatus.value = "synced";
        lastError.value = "";
        await clearAccountDraft(user.value.id ?? user.value.username);
        return;
      }

      const snapshot = exportSnapshot();
      const vault = await encryptVault(snapshot, vaultKey);
      const response = await updateSPlayerVault({ revision: remote.revision, vault });
      revision.value = response.revision;
      encryptedVault = response.vault;
      syncStatus.value = "synced";
      lastError.value = "";
      await clearAccountDraft(user.value.id ?? user.value.username);
    } catch (error) {
      syncStatus.value = "conflict";
      lastError.value = getSPlayerApiErrorMessage(error) ?? "处理同步冲突失败";
      throw error;
    }
  };

  const acknowledgeRecoveryKey = () => {
    pendingRecoveryKey.value = "";
    pendingRegistrationConfirmed.value = false;
    void clearPendingRegistration();
  };

  const logout = async (): Promise<void> => {
    if (status.value === "authenticated") await syncNow();
    await logoutSPlayerAccount();
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    await draftWriteQueue;
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
  };
});
