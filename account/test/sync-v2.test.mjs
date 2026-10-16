import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAccountApp } from "../app.mjs";
import { openDatabase } from "../database.mjs";

const encryption = {
  kdfSalt: "client-kdf-salt",
  kdfIterations: 600000,
  wrappedVaultKey: { nonce: "wrap-nonce", ciphertext: "wrap-ciphertext" },
  recoveryWrappedVaultKey: { nonce: "recovery-nonce", ciphertext: "recovery-ciphertext" },
};
const vault = {
  schemaVersion: 1,
  nonce: "vault-nonce",
  ciphertext: "vault-ciphertext",
};
const authSecret = "a".repeat(43);
const recoveryVerifier = "r".repeat(43);
const nonce = Buffer.alloc(12, 1).toString("base64url");

function sessionCookie(response) {
  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieHeader?.split(";", 1)[0];
}

async function register(app, username) {
  const response = await app.inject({
    method: "POST",
    url: "/api/splayer/register",
    payload: { username, authSecret, recoveryVerifier, encryption, vault },
  });
  assert.equal(response.statusCode, 201);
  return { response, cookie: sessionCookie(response) };
}

async function migrate(app, cookie, revision = 1) {
  return app.inject({
    method: "POST",
    url: "/api/splayer/sync/migrate",
    headers: { cookie },
    payload: { revision },
  });
}

function operation(number, options = {}) {
  return {
    operationId: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    deviceId: options.deviceId ?? "10000000-0000-4000-8000-000000000001",
    deviceSeq: options.deviceSeq ?? number,
    baseCursor: options.baseCursor ?? 0,
    nonce,
    ciphertext: Buffer.from(options.ciphertext ?? `ciphertext-${number}`).toString("base64url"),
  };
}

async function append(app, cookie, operations) {
  return app.inject({
    method: "POST",
    url: "/api/splayer/sync/operations",
    headers: { cookie },
    payload: { operations },
  });
}

test("SQLite 同步迁移回填旧账户且可重复打开", () => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-sync-schema-"));
  const databasePath = join(directory, "account.db");
  try {
    const database = openDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO users
         (id, username, normalized_username, password_salt, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("legacy-user", "Legacy", "legacy", Buffer.alloc(16), Buffer.alloc(64), 1, 2);
    database.exec(`
      DROP TABLE vault_operations;
      DROP TABLE account_sync_state;
      DELETE FROM schema_migrations WHERE version >= 4;
    `);
    database.close();

    const migrated = openDatabase(databasePath);
    assert.deepEqual(
      migrated
        .prepare(
          `SELECT sync_version, head_cursor, operation_count, operation_bytes
           FROM account_sync_state WHERE user_id = ?`,
        )
        .get("legacy-user"),
      { sync_version: 1, head_cursor: 0, operation_count: 0, operation_bytes: 0 },
    );
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version >= 4").get()
        .count,
      2,
    );
    migrated.close();
    openDatabase(databasePath).close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 支持迁移、并发游标、幂等、分页和账户隔离", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-sync-api-"));
  const app = await buildAccountApp({ databasePath: join(directory, "account.db") });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const first = await register(app, "Sync.User.One");
  assert.deepEqual(first.response.json().sync, {
    protocolVersion: 1,
    mode: "vault",
    headCursor: 0,
  });

  const beforeMigration = await append(app, first.cookie, [operation(1)]);
  assert.equal(beforeMigration.statusCode, 409);
  assert.equal(beforeMigration.json().error.code, "SYNC_MIGRATION_REQUIRED");

  const wrongRevision = await migrate(app, first.cookie, 2);
  assert.equal(wrongRevision.statusCode, 409);
  assert.equal(wrongRevision.json().error.code, "REVISION_CONFLICT");

  const migration = await migrate(app, first.cookie);
  assert.equal(migration.statusCode, 200);
  assert.equal(migration.json().sync.protocolVersion, 2);
  assert.equal((await migrate(app, first.cookie)).statusCode, 200);

  const invalidOperation = await append(app, first.cookie, [
    { ...operation(99), unexpected: true },
  ]);
  assert.equal(invalidOperation.statusCode, 400);
  assert.equal(invalidOperation.json().error.code, "INVALID_REQUEST");

  const concurrent = await Promise.all([
    append(app, first.cookie, [operation(1)]),
    append(app, first.cookie, [
      operation(2, {
        deviceId: "20000000-0000-4000-8000-000000000002",
        deviceSeq: 1,
      }),
    ]),
  ]);
  assert.deepEqual(
    concurrent.map((response) => response.statusCode),
    [200, 200],
  );
  assert.deepEqual(
    concurrent.map((response) => response.json().operations[0].cursor).sort((a, b) => a - b),
    [1, 2],
  );

  const sharedDevice = "30000000-0000-4000-8000-000000000003";
  const duplicateSequence = await Promise.all([
    append(app, first.cookie, [operation(10, { deviceId: sharedDevice, deviceSeq: 1 })]),
    append(app, first.cookie, [operation(11, { deviceId: sharedDevice, deviceSeq: 1 })]),
  ]);
  assert.deepEqual(
    duplicateSequence.map((response) => response.statusCode),
    [200, 200],
  );

  const retry = await append(app, first.cookie, [operation(1)]);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().operations[0].duplicate, true);
  assert.equal(retry.json().operations[0].cursor, concurrent[0].json().operations[0].cursor);

  const conflictingRetry = await append(app, first.cookie, [
    operation(1, { ciphertext: "different" }),
  ]);
  assert.equal(conflictingRetry.statusCode, 409);
  assert.equal(conflictingRetry.json().error.code, "OPERATION_ID_CONFLICT");

  const third = await append(app, first.cookie, [operation(3)]);
  assert.equal(third.statusCode, 200);
  const firstPage = await app.inject({
    method: "GET",
    url: "/api/splayer/sync/operations?after=0&limit=2",
    headers: { cookie: first.cookie },
  });
  assert.equal(firstPage.statusCode, 200);
  assert.equal(firstPage.json().operations.length, 2);
  assert.equal(firstPage.json().nextCursor, 2);
  assert.equal(firstPage.json().hasMore, true);
  const secondPage = await app.inject({
    method: "GET",
    url: "/api/splayer/sync/operations?after=2&limit=2",
    headers: { cookie: first.cookie },
  });
  assert.deepEqual(
    secondPage.json().operations.map(({ cursor }) => cursor),
    [3, 4],
  );
  assert.equal(secondPage.json().hasMore, true);
  const thirdPage = await app.inject({
    method: "GET",
    url: "/api/splayer/sync/operations?after=4&limit=2",
    headers: { cookie: first.cookie },
  });
  assert.deepEqual(
    thirdPage.json().operations.map(({ cursor }) => cursor),
    [5],
  );
  assert.equal(thirdPage.json().hasMore, false);

  const second = await register(app, "Sync.User.Two");
  assert.equal((await migrate(app, second.cookie)).statusCode, 200);
  const isolatedPull = await app.inject({
    method: "GET",
    url: "/api/splayer/sync/operations?after=0",
    headers: { cookie: second.cookie },
  });
  assert.deepEqual(isolatedPull.json().operations, []);
  assert.equal(isolatedPull.json().headCursor, 0);

  const legacyWrite = await app.inject({
    method: "PUT",
    url: "/api/splayer/vault",
    headers: { cookie: first.cookie },
    payload: { revision: 1, vault },
  });
  assert.equal(legacyWrite.statusCode, 409);
  assert.equal(legacyWrite.json().error.code, "CLIENT_UPDATE_REQUIRED");
});

test("容量错误回滚整批操作和游标", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-sync-capacity-"));
  const app = await buildAccountApp({
    databasePath: join(directory, "account.db"),
    maxSyncOperations: 1,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const account = await register(app, "Capacity.User");
  await migrate(app, account.cookie);
  const rejected = await append(app, account.cookie, [operation(1), operation(2)]);
  assert.equal(rejected.statusCode, 507);
  assert.equal(rejected.json().error.code, "SYNC_CAPACITY_REACHED");

  const info = await app.inject({
    method: "GET",
    url: "/api/splayer/sync/info",
    headers: { cookie: account.cookie },
  });
  assert.equal(info.json().sync.headCursor, 0);
  assert.equal(info.json().sync.operationCount, 0);
});

test("支持包含大型本地歌单封面的加密操作", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-sync-large-operation-"));
  const app = await buildAccountApp({ databasePath: join(directory, "account.db") });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const account = await register(app, "Large.Operation");
  await migrate(app, account.cookie);
  const largeOperation = operation(1, { ciphertext: "x".repeat(1024 * 1024) });
  const response = await append(app, account.cookie, [largeOperation]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().headCursor, 1);
});

test("SSE 只通知账户游标", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-sync-sse-"));
  const app = await buildAccountApp({ databasePath: join(directory, "account.db") });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const account = await register(app, "Events.User");
  await migrate(app, account.cookie);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/splayer/sync/events?cursor=0`,
    { headers: { cookie: account.cookie }, signal: controller.signal },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const initialEvent = decoder.decode((await reader.read()).value);
  assert.match(initialEvent, /event: cursor\ndata: \{"cursor":0\}/u);

  const encryptedOperation = operation(1, { ciphertext: "secret-payload" });
  const appended = await append(app, account.cookie, [encryptedOperation]);
  assert.equal(appended.statusCode, 200);
  const notification = decoder.decode((await reader.read()).value);
  assert.match(notification, /event: cursor\ndata: \{"cursor":1\}/u);
  assert.doesNotMatch(notification, /secret-payload|ciphertext|nonce/u);
  controller.abort();
  await reader.cancel().catch(() => {});
});
