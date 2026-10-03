import type {
  EncryptedValue,
  EncryptedVault,
  SPlayerEncryption,
  SPlayerVaultSnapshot,
} from "@/types/account";
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const MIN_KDF_ITERATIONS = 600_000;
const AES_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const VAULT_AAD = new TextEncoder().encode("SPLAYER_VAULT_V1");
const PASSWORD_WRAP_AAD = new TextEncoder().encode("SPLAYER_PASSWORD_WRAP_V1");
const RECOVERY_WRAP_AAD = new TextEncoder().encode("SPLAYER_RECOVERY_WRAP_V1");
const AUTH_DOMAIN = "SPLAYER_AUTH_V1";
const PENDING_RECOVERY_AAD = new TextEncoder().encode("SPLAYER_PENDING_RECOVERY_V1");

export class VaultUnlockError extends Error {
  constructor(message = "密码错误或保险库数据已损坏") {
    super(message);
    this.name = "VaultUnlockError";
  }
}

export type AccountCryptoKey = CryptoKey | Uint8Array<ArrayBuffer>;

const hasWebCrypto = () => Boolean(globalThis.crypto?.subtle);

const randomBytes = (length: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
};

const bytesToBase64Url = (bytes: Uint8Array<ArrayBuffer>): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const hashBytes = async (bytes: Uint8Array<ArrayBuffer>) =>
  bytesToBase64Url(
    hasWebCrypto()
      ? new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
      : new Uint8Array(sha256(bytes)),
  );

export const deriveRecoveryProof = async (recoveryKey: string) =>
  hashBytes(base64UrlToBytes(recoveryKey));

export interface ProtectedRecoveryKey {
  kdfSalt: string;
  kdfIterations: number;
  encrypted: EncryptedValue;
}

export const protectRecoveryKey = async (
  password: string,
  recoveryKey: string,
): Promise<ProtectedRecoveryKey> => {
  const kdfSalt = randomBytes(SALT_BYTES);
  const wrappingKey = await deriveWrappingKey(password, kdfSalt, MIN_KDF_ITERATIONS);
  return {
    kdfSalt: bytesToBase64Url(kdfSalt),
    kdfIterations: MIN_KDF_ITERATIONS,
    encrypted: await encryptBytes(
      new TextEncoder().encode(recoveryKey),
      wrappingKey,
      PENDING_RECOVERY_AAD,
    ),
  };
};

export const unprotectRecoveryKey = async (
  password: string,
  protectedKey: ProtectedRecoveryKey,
): Promise<string> => {
  const wrappingKey = await deriveWrappingKey(
    password,
    base64UrlToBytes(protectedKey.kdfSalt),
    protectedKey.kdfIterations,
  );
  return new TextDecoder().decode(
    await decryptBytes(protectedKey.encrypted, wrappingKey, PENDING_RECOVERY_AAD),
  );
};

const importAesKey = async (
  rawKey: Uint8Array<ArrayBuffer>,
  extractable = false,
): Promise<AccountCryptoKey> => {
  if (!hasWebCrypto()) return rawKey.slice();
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, extractable, [
    "encrypt",
    "decrypt",
  ]);
};

const exportAesKey = async (key: AccountCryptoKey): Promise<Uint8Array<ArrayBuffer>> => {
  if (key instanceof Uint8Array) return key.slice();
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
};

const deriveWrappingKey = async (
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<AccountCryptoKey> => {
  if (!hasWebCrypto()) {
    return new Uint8Array(
      await pbkdf2Async(sha256, new TextEncoder().encode(password), salt, {
        c: iterations,
        dkLen: AES_KEY_BYTES,
      }),
    );
  }
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/** 派生只用于服务端认证的秘密，不复用保险库包装密钥 */
export const deriveAuthenticationSecret = async (
  username: string,
  password: string,
): Promise<string> => {
  const normalizedUsername = username.normalize("NFKC").trim().toLocaleLowerCase("und");
  const saltInput = new TextEncoder().encode(`${AUTH_DOMAIN}:${normalizedUsername}`);
  if (!hasWebCrypto()) {
    const secret = await pbkdf2Async(
      sha256,
      new TextEncoder().encode(password),
      sha256(saltInput),
      {
        c: MIN_KDF_ITERATIONS,
        dkLen: AES_KEY_BYTES,
      },
    );
    return bytesToBase64Url(new Uint8Array(secret));
  }
  const salt = await crypto.subtle.digest("SHA-256", saltInput);
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const secret = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: MIN_KDF_ITERATIONS },
    passwordKey,
    256,
  );
  return bytesToBase64Url(new Uint8Array(secret));
};

const encryptBytes = async (
  plaintext: Uint8Array<ArrayBuffer>,
  key: AccountCryptoKey,
  additionalData?: Uint8Array<ArrayBuffer>,
): Promise<EncryptedValue> => {
  const nonce = randomBytes(NONCE_BYTES);
  if (key instanceof Uint8Array) {
    return {
      nonce: bytesToBase64Url(nonce),
      ciphertext: bytesToBase64Url(
        new Uint8Array(gcm(key, nonce, additionalData).encrypt(plaintext)),
      ),
    };
  }
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData },
    key,
    plaintext,
  );
  return {
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
};

const decryptBytes = async (
  encrypted: EncryptedValue,
  key: AccountCryptoKey,
  additionalData?: Uint8Array<ArrayBuffer>,
) => {
  if (key instanceof Uint8Array) {
    return new Uint8Array(
      gcm(key, base64UrlToBytes(encrypted.nonce), additionalData).decrypt(
        base64UrlToBytes(encrypted.ciphertext),
      ),
    );
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(encrypted.nonce), additionalData },
    key,
    base64UrlToBytes(encrypted.ciphertext),
  );
  return new Uint8Array(plaintext);
};

export const encryptVault = async (
  snapshot: SPlayerVaultSnapshot,
  vaultKey: AccountCryptoKey,
): Promise<EncryptedVault> => ({
  schemaVersion: snapshot.schemaVersion,
  ...(await encryptBytes(new TextEncoder().encode(JSON.stringify(snapshot)), vaultKey, VAULT_AAD)),
});

export const decryptVault = async (
  vault: EncryptedVault,
  vaultKey: AccountCryptoKey,
): Promise<SPlayerVaultSnapshot> => {
  const plaintext = await decryptBytes(vault, vaultKey, VAULT_AAD);
  const snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as SPlayerVaultSnapshot;
  if (
    snapshot.schemaVersion !== 1 ||
    !snapshot.data ||
    !snapshot.local ||
    (snapshot.preferences && snapshot.preferences.schemaVersion !== 1)
  ) {
    throw new Error("不支持的保险库数据格式");
  }
  return snapshot;
};

export const createEncryptedVault = async (
  password: string,
  snapshot: SPlayerVaultSnapshot,
  iterations: number = MIN_KDF_ITERATIONS,
) => {
  const kdfIterations = Math.max(iterations, MIN_KDF_ITERATIONS);
  const vaultKeyBytes = randomBytes(AES_KEY_BYTES);
  const recoveryKeyBytes = randomBytes(AES_KEY_BYTES);
  const kdfSalt = randomBytes(SALT_BYTES);
  const [vaultKey, passwordWrappingKey, recoveryWrappingKey] = await Promise.all([
    importAesKey(vaultKeyBytes, true),
    deriveWrappingKey(password, kdfSalt, kdfIterations),
    importAesKey(recoveryKeyBytes),
  ]);
  const [wrappedVaultKey, recoveryWrappedVaultKey, vault] = await Promise.all([
    encryptBytes(vaultKeyBytes, passwordWrappingKey, PASSWORD_WRAP_AAD),
    encryptBytes(vaultKeyBytes, recoveryWrappingKey, RECOVERY_WRAP_AAD),
    encryptVault(snapshot, vaultKey),
  ]);
  const encryption: SPlayerEncryption = {
    kdfSalt: bytesToBase64Url(kdfSalt),
    kdfIterations,
    wrappedVaultKey,
    recoveryWrappedVaultKey,
  };
  return {
    encryption,
    vault,
    vaultKey,
    recoveryKey: bytesToBase64Url(recoveryKeyBytes),
    recoveryVerifier: await hashBytes(recoveryKeyBytes),
  };
};

export const unlockVaultWithPassword = async (
  password: string,
  encryption: SPlayerEncryption,
): Promise<AccountCryptoKey> => {
  try {
    const wrappingKey = await deriveWrappingKey(
      password,
      base64UrlToBytes(encryption.kdfSalt),
      Math.max(encryption.kdfIterations, MIN_KDF_ITERATIONS),
    );
    const vaultKey = await decryptBytes(encryption.wrappedVaultKey, wrappingKey, PASSWORD_WRAP_AAD);
    return importAesKey(vaultKey, true);
  } catch {
    throw new VaultUnlockError();
  }
};

export const unlockVaultWithRecoveryKey = async (
  recoveryKey: string,
  encryption: SPlayerEncryption,
): Promise<AccountCryptoKey> => {
  try {
    const wrappingKey = await importAesKey(base64UrlToBytes(recoveryKey));
    const vaultKey = await decryptBytes(
      encryption.recoveryWrappedVaultKey,
      wrappingKey,
      RECOVERY_WRAP_AAD,
    );
    return importAesKey(vaultKey, true);
  } catch {
    throw new VaultUnlockError("恢复密钥错误或保险库数据已损坏");
  }
};

export const rewrapVaultKeyWithPassword = async (
  password: string,
  vaultKey: AccountCryptoKey,
  encryption: SPlayerEncryption,
  iterations: number = MIN_KDF_ITERATIONS,
): Promise<SPlayerEncryption> => {
  const kdfIterations = Math.max(iterations, MIN_KDF_ITERATIONS);
  const kdfSalt = randomBytes(SALT_BYTES);
  const [vaultKeyBytes, wrappingKey] = await Promise.all([
    exportAesKey(vaultKey),
    deriveWrappingKey(password, kdfSalt, kdfIterations),
  ]);
  return {
    ...encryption,
    kdfSalt: bytesToBase64Url(kdfSalt),
    kdfIterations,
    wrappedVaultKey: await encryptBytes(vaultKeyBytes, wrappingKey, PASSWORD_WRAP_AAD),
  };
};
