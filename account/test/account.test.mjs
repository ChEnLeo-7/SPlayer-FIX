import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAccountApp } from "../app.mjs";

const encryption = {
  kdfSalt: "client-kdf-salt",
  kdfIterations: 600000,
  wrappedVaultKey: {
    nonce: "password-wrap-nonce",
    ciphertext: "password-wrap-ciphertext",
  },
  recoveryWrappedVaultKey: {
    nonce: "recovery-wrap-nonce",
    ciphertext: "recovery-wrap-ciphertext",
  },
};

const initialVault = {
  schemaVersion: 1,
  nonce: "vault-nonce-1",
  ciphertext: "vault-ciphertext-1",
};
const recoveryVerifier = "r".repeat(43);

function authSecret(username, password) {
  const normalizedUsername = username.normalize("NFKC").trim().toLocaleLowerCase("und");
  const salt = createHash("sha256").update(`SPLAYER_AUTH_V1:${normalizedUsername}`).digest();
  return pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("base64url");
}

function sessionCookie(response) {
  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieHeader?.split(";", 1)[0];
}

test("账户 API 完整流程", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-account-"));
  const app = await buildAccountApp({
    databasePath: join(directory, "account.db"),
    adminToken: "test-admin-token",
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const registration = await app.inject({
    method: "POST",
    url: "/api/splayer/register",
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", "correct-password"),
      recoveryVerifier,
      encryption,
      vault: initialVault,
    },
  });
  assert.equal(registration.statusCode, 201);
  assert.equal(registration.json().user.username, "Test.User");
  assert.equal(registration.json().revision, 1);
  assert.deepEqual(registration.json().encryption, encryption);
  assert.deepEqual(registration.json().vault, initialVault);
  assert.match(registration.headers["set-cookie"], /HttpOnly/i);
  assert.match(registration.headers["set-cookie"], /SameSite=Strict/i);
  assert.doesNotMatch(registration.body, /password_hash|passwordHash/);
  assert.doesNotMatch(
    readFileSync(join(directory, "account.db")).toString("latin1"),
    /correct-password/u,
  );

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/splayer/register",
    payload: {
      username: "test.user",
      authSecret: authSecret("test.user", "another-password"),
      recoveryVerifier,
      encryption,
      vault: initialVault,
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "USERNAME_TAKEN");

  const wrongPassword = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: { username: "Test.User", authSecret: authSecret("Test.User", "wrong-password") },
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(wrongPassword.json().error.code, "INVALID_CREDENTIALS");

  const login = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: {
      username: " test.user ",
      authSecret: authSecret("test.user", "correct-password"),
    },
  });
  assert.equal(login.statusCode, 200);
  let cookie = sessionCookie(login);
  assert.ok(cookie);

  const session = await app.inject({
    method: "GET",
    url: "/api/splayer/session",
    headers: { cookie },
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().user.mustChangePassword, false);
  const rotatedCookie = sessionCookie(session);
  assert.ok(rotatedCookie);
  assert.equal(rotatedCookie, cookie);
  cookie = rotatedCookie;

  const concurrentSessions = await Promise.all([
    app.inject({ method: "GET", url: "/api/splayer/session", headers: { cookie } }),
    app.inject({ method: "GET", url: "/api/splayer/session", headers: { cookie } }),
  ]);
  assert.deepEqual(
    concurrentSessions.map((response) => response.statusCode),
    [200, 200],
  );

  const rejectedOrigin = await app.inject({
    method: "GET",
    url: "/api/splayer/session",
    headers: { cookie, host: "localhost", origin: "https://attacker.invalid" },
  });
  assert.equal(rejectedOrigin.statusCode, 403);

  const insecureLogin = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    headers: { host: "192.168.1.2", origin: "http://192.168.1.2" },
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", "correct-password"),
    },
  });
  assert.equal(insecureLogin.statusCode, 200);

  const nextVault = {
    schemaVersion: 1,
    nonce: "vault-nonce-2",
    ciphertext: "vault-ciphertext-2",
  };
  const vaultUpdate = await app.inject({
    method: "PUT",
    url: "/api/splayer/vault",
    headers: { cookie },
    payload: { revision: 1, vault: nextVault },
  });
  assert.equal(vaultUpdate.statusCode, 200);
  assert.equal(vaultUpdate.json().revision, 2);
  cookie = sessionCookie(vaultUpdate);

  const vaultConflict = await app.inject({
    method: "PUT",
    url: "/api/splayer/vault",
    headers: { cookie },
    payload: { revision: 1, vault: initialVault },
  });
  assert.equal(vaultConflict.statusCode, 409);
  assert.equal(vaultConflict.json().error.code, "REVISION_CONFLICT");
  assert.equal(vaultConflict.json().revision, 2);
  cookie = sessionCookie(vaultConflict);

  const reset = await app.inject({
    method: "POST",
    url: "/api/splayer/admin/reset-password",
    headers: { authorization: "Bearer test-admin-token" },
    payload: { username: "TEST.USER" },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().recoveryRequired, true);
  assert.equal(reset.json().user.mustChangePassword, true);
  assert.ok(reset.json().temporaryPassword.length >= 8);

  const revokedSession = await app.inject({
    method: "GET",
    url: "/api/splayer/session",
    headers: { cookie },
  });
  assert.equal(revokedSession.statusCode, 401);

  const oldPassword = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", "correct-password"),
    },
  });
  assert.equal(oldPassword.statusCode, 401);

  const temporaryLogin = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", reset.json().temporaryPassword),
    },
  });
  assert.equal(temporaryLogin.statusCode, 200);
  assert.equal(temporaryLogin.json().user.mustChangePassword, true);
  assert.deepEqual(temporaryLogin.json().vault, nextVault);

  const reusedTemporaryPassword = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", reset.json().temporaryPassword),
    },
  });
  assert.equal(reusedTemporaryPassword.statusCode, 401);
  assert.equal(reusedTemporaryPassword.json().error.code, "TEMPORARY_PASSWORD_USED");

  const blockedVaultUpdate = await app.inject({
    method: "PUT",
    url: "/api/splayer/vault",
    headers: { cookie: sessionCookie(temporaryLogin) },
    payload: { revision: 2, vault: initialVault },
  });
  assert.equal(blockedVaultUpdate.statusCode, 403);
  assert.equal(blockedVaultUpdate.json().error.code, "PASSWORD_CHANGE_REQUIRED");

  const passwordEncryption = {
    kdfSalt: "new-client-kdf-salt",
    kdfIterations: 600000,
    wrappedVaultKey: {
      nonce: "new-password-wrap-nonce",
      ciphertext: "new-password-wrap-ciphertext",
    },
  };
  const passwordChangeWithoutRecovery = await app.inject({
    method: "POST",
    url: "/api/splayer/password",
    headers: { cookie: sessionCookie(temporaryLogin) },
    payload: {
      currentAuthSecret: authSecret("Test.User", reset.json().temporaryPassword),
      newAuthSecret: authSecret("Test.User", "replacement-password"),
      passwordEncryption,
    },
  });
  assert.equal(passwordChangeWithoutRecovery.statusCode, 400);

  const passwordChange = await app.inject({
    method: "POST",
    url: "/api/splayer/password",
    headers: { cookie: sessionCookie(temporaryLogin) },
    payload: {
      currentAuthSecret: authSecret("Test.User", reset.json().temporaryPassword),
      newAuthSecret: authSecret("Test.User", "replacement-password"),
      passwordEncryption,
      recoveryProof: recoveryVerifier,
    },
  });
  assert.equal(passwordChange.statusCode, 200);
  assert.equal(passwordChange.json().user.mustChangePassword, false);
  assert.deepEqual(
    passwordChange.json().encryption.wrappedVaultKey,
    passwordEncryption.wrappedVaultKey,
  );
  assert.deepEqual(
    passwordChange.json().encryption.recoveryWrappedVaultKey,
    encryption.recoveryWrappedVaultKey,
  );

  const temporaryPasswordExpired = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", reset.json().temporaryPassword),
    },
  });
  assert.equal(temporaryPasswordExpired.statusCode, 401);

  const replacementLogin = await app.inject({
    method: "POST",
    url: "/api/splayer/login",
    payload: {
      username: "Test.User",
      authSecret: authSecret("Test.User", "replacement-password"),
    },
  });
  assert.equal(replacementLogin.statusCode, 200);

  const logout = await app.inject({
    method: "POST",
    url: "/api/splayer/logout",
    headers: { cookie: sessionCookie(replacementLogin) },
  });
  assert.equal(logout.statusCode, 204);

  const loggedOutSession = await app.inject({
    method: "GET",
    url: "/api/splayer/session",
    headers: { cookie: sessionCookie(replacementLogin) },
  });
  assert.equal(loggedOutSession.statusCode, 401);
});
