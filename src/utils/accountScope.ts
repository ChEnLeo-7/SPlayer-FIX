import type { EncryptedVault, SPlayerVaultSnapshot } from "@/types/account";
import type { ProtectedRecoveryKey } from "@/utils/accountCrypto";
import localforage from "localforage";

const scopeDB = localforage.createInstance({
  name: "splayer-account-scopes",
  description: "SPlayer 账户作用域快照",
  storeName: "scopes",
});

const GUEST_SNAPSHOT_KEY = "guest-snapshot";
const ACTIVE_SCOPE_KEY = "active-scope";

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
