import localforage from "localforage";

interface StoredAccountDeviceKey {
  version: 1;
  key: string;
}

const deviceKeyDB = localforage.createInstance({
  name: "splayer-account-device-keys",
  description: "SPlayer Web 账户设备密钥",
  storeName: "keys",
});

const getStorageKey = (accountId: string | number) =>
  `${globalThis.location?.origin || "unknown-origin"}\n${String(accountId)}`;

export const saveWebAccountDeviceKey = (
  accountId: string | number,
  key: string,
): Promise<StoredAccountDeviceKey> =>
  deviceKeyDB.setItem(getStorageKey(accountId), {
    version: 1,
    key,
  });

export const getWebAccountDeviceKey = async (
  accountId: string | number,
): Promise<string | null> => {
  const stored = await deviceKeyDB.getItem<StoredAccountDeviceKey>(getStorageKey(accountId));
  return stored?.version === 1 && typeof stored.key === "string" ? stored.key : null;
};

export const deleteWebAccountDeviceKey = (accountId: string | number) =>
  deviceKeyDB.removeItem(getStorageKey(accountId));
