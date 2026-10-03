import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import type { SPlayerVaultSnapshot } from "../../src/types/account";
import {
  createEncryptedVault,
  deriveAuthenticationSecret,
  deriveRecoveryProof,
  decryptVault,
  encryptVault,
  protectRecoveryKey,
  rewrapVaultKeyWithPassword,
  unlockVaultWithPassword,
  unlockVaultWithRecoveryKey,
  unprotectRecoveryKey,
} from "../../src/utils/accountCrypto";

const snapshot: SPlayerVaultSnapshot = {
  schemaVersion: 1,
  data: {
    userLikeData: {
      songs: [123],
      playlists: [],
      artists: [],
      albums: [],
      mvs: [],
      djs: [],
    },
    likeSongsList: {
      detail: { id: 0, name: "我喜欢的音乐" },
      data: [
        {
          id: 123,
          name: "Sensitive Song Title",
          artists: [{ id: 1, name: "Private Artist" }],
          album: { id: 2, name: "Private Album" },
          cover: "https://example.invalid/private.jpg",
          duration: 180000,
        },
      ],
    },
    historyList: [],
    playList: [],
    originalPlayList: [],
  },
  local: { localPlaylists: [], playlistSongs: [] },
};

test("客户端保险库加密、恢复和密码重包装", async () => {
  const expectedAuthSecret = pbkdf2Sync(
    "initial-password",
    createHash("sha256").update("SPLAYER_AUTH_V1:test.user").digest(),
    600000,
    32,
    "sha256",
  ).toString("base64url");
  assert.equal(
    await deriveAuthenticationSecret("Test.User", "initial-password"),
    expectedAuthSecret,
  );
  const created = await createEncryptedVault("initial-password", snapshot);
  assert.equal(await deriveRecoveryProof(created.recoveryKey), created.recoveryVerifier);
  assert.doesNotMatch(created.vault.ciphertext, /Sensitive Song Title|Private Artist/u);
  const protectedRecoveryKey = await protectRecoveryKey("initial-password", created.recoveryKey);
  assert.equal(
    await unprotectRecoveryKey("initial-password", protectedRecoveryKey),
    created.recoveryKey,
  );

  const passwordKey = await unlockVaultWithPassword("initial-password", created.encryption);
  assert.deepEqual(await decryptVault(created.vault, passwordKey), snapshot);
  await assert.rejects(() => unlockVaultWithPassword("wrong-password", created.encryption));

  const recoveryKey = await unlockVaultWithRecoveryKey(created.recoveryKey, created.encryption);
  const nextEncryption = await rewrapVaultKeyWithPassword(
    "replacement-password",
    recoveryKey,
    created.encryption,
  );
  assert.deepEqual(
    nextEncryption.recoveryWrappedVaultKey,
    created.encryption.recoveryWrappedVaultKey,
  );
  const replacementKey = await unlockVaultWithPassword("replacement-password", nextEncryption);
  assert.deepEqual(await decryptVault(created.vault, replacementKey), snapshot);

  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: <T extends ArrayBufferView | null>(array: T) =>
        originalCrypto.getRandomValues(array),
    },
  });
  try {
    assert.equal(
      await deriveAuthenticationSecret("Test.User", "initial-password"),
      expectedAuthSecret,
    );
    const fallbackKey = await unlockVaultWithPassword("initial-password", created.encryption);
    assert.deepEqual(await decryptVault(created.vault, fallbackKey), snapshot);
    const fallbackVault = await encryptVault(snapshot, fallbackKey);
    const fallbackEncryption = await rewrapVaultKeyWithPassword(
      "fallback-password",
      fallbackKey,
      created.encryption,
    );

    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
    const webCryptoKey = await unlockVaultWithPassword("fallback-password", fallbackEncryption);
    assert.deepEqual(await decryptVault(fallbackVault, webCryptoKey), snapshot);
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  }
});
