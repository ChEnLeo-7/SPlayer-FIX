import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAccountApp } from "../app.mjs";
import type { SPlayerOperationMetadata, SPlayerVaultSnapshot } from "../../src/types/account";
import type { SongType } from "../../src/types/main";
import {
  createEncryptedVault,
  decryptSPlayerOperation,
  deriveAuthenticationSecret,
  encryptSPlayerOperation,
} from "../../src/utils/accountCrypto";
import {
  applyAccountMutations,
  applySPlayerOperations,
  createBaselineVersionTable,
  createSPlayerOperationBatches,
  createSPlayerOperationMetadata,
  diffVaultSnapshots,
  vaultSnapshotToMutations,
} from "../../src/utils/accountSync";

const song = (id: number, name = `song-${id}`): SongType => ({
  id,
  name,
  artists: [{ id: 10, name: "artist" }],
  album: { id: 20, name: "album" },
  cover: "cover",
  duration: 180_000,
  free: 0,
  mv: null,
  type: "song",
});

const emptySnapshot = (): SPlayerVaultSnapshot => ({
  schemaVersion: 1,
  data: {
    userLikeData: { songs: [], playlists: [], artists: [], albums: [], mvs: [], djs: [] },
    likeSongsList: { detail: { id: 0, name: "liked", cover: "", count: 0 }, data: [] },
    historyList: [],
    playList: [],
    originalPlayList: [],
  },
  local: { localPlaylists: [], playlistSongs: [] },
});

const fullSnapshot = (): SPlayerVaultSnapshot => ({
  schemaVersion: 1,
  data: {
    userLikeData: {
      songs: [1],
      playlists: [{ id: 2, name: "playlist", cover: "p" }],
      artists: [{ id: 3, name: "artist", cover: "a" }],
      albums: [{ id: 4, name: "album", cover: "b" }],
      mvs: [{ id: 5, name: "mv", cover: "m" }],
      djs: [{ id: 6, name: "podcast", cover: "d" }],
    },
    likeSongsList: {
      detail: { id: 0, name: "liked", cover: "", count: 1 },
      data: [song(1)],
    },
    historyList: [song(7)],
    playList: [song(8)],
    originalPlayList: [song(9)],
  },
  local: {
    localPlaylists: [
      {
        id: 100,
        name: "private",
        description: "metadata",
        songs: ["10"],
        createTime: 1,
        updateTime: 2,
      },
    ],
    playlistSongs: [song(10)],
  },
  preferences: {
    schemaVersion: 1,
    setting: { themeMode: "dark", nested: { enabled: true } },
    status: { pureLyricMode: true },
    shortcut: { playNext: "KeyN" },
  },
});

const metadata = (
  deviceId: string,
  deviceSeq: number,
  baseCursor = 0,
): SPlayerOperationMetadata => ({
  operationId: `${deviceId}:${deviceSeq}`,
  deviceId,
  deviceSeq,
  baseCursor,
});

const operation = (
  before: SPlayerVaultSnapshot,
  after: SPlayerVaultSnapshot,
  operationMetadata: SPlayerOperationMetadata,
  cursor: number,
) => ({
  metadata: operationMetadata,
  cursor,
  payload: { schemaVersion: 1 as const, mutations: diffVaultSnapshots(before, after) },
});

test("schema 1 快照可完整映射并重建", () => {
  const expected = fullSnapshot();
  const result = applyAccountMutations(
    emptySnapshot(),
    {},
    vaultSnapshotToMutations(expected),
    metadata("baseline", 1),
    0,
  );
  assert.deepEqual(result.snapshot, expected);

  const versions = createBaselineVersionTable(expected, 9);
  assert.ok(Object.keys(versions).length >= 16);
  assert.ok(Object.values(versions).every((version) => version.cursor === 9));
});

test("并发操作满足交换律且重复应用幂等", () => {
  const baseline = emptySnapshot();
  const baselineVersions = createBaselineVersionTable(baseline, 0);
  const withSong = structuredClone(baseline);
  withSong.data.userLikeData.songs = [1];
  withSong.data.likeSongsList.data = [song(1)];
  withSong.data.likeSongsList.detail.count = 1;
  const withAlbum = structuredClone(baseline);
  withAlbum.data.userLikeData.albums = [{ id: 4, name: "album", cover: "a" }];
  const left = operation(baseline, withSong, metadata("left", 1), 1);
  const right = operation(baseline, withAlbum, metadata("right", 1), 2);

  const leftRight = applySPlayerOperations(baseline, baselineVersions, [left, right]);
  const rightLeft = applySPlayerOperations(baseline, baselineVersions, [right, left]);
  assert.deepEqual(leftRight, rightLeft);

  const repeated = applySPlayerOperations(leftRight.snapshot, leftRight.versions, [left, right]);
  assert.deepEqual(repeated, leftRight);
});

test("同设备序号冲突仍按操作 ID 稳定收敛", () => {
  const baseline = emptySnapshot();
  const versions = createBaselineVersionTable(baseline, 0);
  const firstSnapshot = structuredClone(baseline);
  firstSnapshot.data.userLikeData.albums = [{ id: 4, name: "first", cover: "a" }];
  const secondSnapshot = structuredClone(baseline);
  secondSnapshot.data.userLikeData.albums = [{ id: 4, name: "second", cover: "b" }];
  const first = operation(
    baseline,
    firstSnapshot,
    { ...metadata("shared-device", 1), operationId: "operation-a" },
    1,
  );
  const second = operation(
    baseline,
    secondSnapshot,
    { ...metadata("shared-device", 1), operationId: "operation-b" },
    2,
  );

  const firstSecond = applySPlayerOperations(baseline, versions, [first, second]);
  const secondFirst = applySPlayerOperations(baseline, versions, [second, first]);
  assert.deepEqual(firstSecond, secondFirst);
  assert.equal(firstSecond.snapshot.data.userLikeData.albums[0].name, "second");
});

test("乐观操作获得服务端游标时会再次物化到当前客户端", () => {
  const baseline = emptySnapshot();
  const changed = structuredClone(baseline);
  changed.data.userLikeData.albums = [{ id: 4, name: "album", cover: "a" }];
  const pending = operation(baseline, changed, metadata("device", 1), 1);
  const optimistic = applySPlayerOperations(baseline, createBaselineVersionTable(baseline, 0), [
    { ...pending, cursor: undefined },
  ]);

  const confirmed = applySPlayerOperations(baseline, optimistic.versions, [pending]);
  assert.deepEqual(confirmed.snapshot.data.userLikeData.albums, changed.data.userLikeData.albums);
  assert.equal(
    Object.values(confirmed.versions).find((version) => version.operationId === "device:1")?.cursor,
    1,
  );
});

test("两个加密客户端经服务端交换操作后收敛", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "splayer-sync-clients-"));
  const app = await buildAccountApp({ databasePath: join(directory, "account.db") });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const username = "Encrypted.Clients";
  const password = "test-password";
  const baseline = emptySnapshot();
  const encrypted = await createEncryptedVault(password, baseline);
  const registration = await app.inject({
    method: "POST",
    url: "/api/splayer/register",
    payload: {
      username,
      authSecret: await deriveAuthenticationSecret(username, password),
      recoveryVerifier: encrypted.recoveryVerifier,
      encryption: encrypted.encryption,
      vault: encrypted.vault,
    },
  });
  assert.equal(registration.statusCode, 201);
  const accountId = registration.json().user.id as string;
  const setCookie = registration.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(";", 1)[0];
  assert.ok(cookie);
  const migration = await app.inject({
    method: "POST",
    url: "/api/splayer/sync/migrate",
    headers: { cookie },
    payload: { revision: 1 },
  });
  assert.equal(migration.statusCode, 200);

  const withSong = structuredClone(baseline);
  withSong.data.userLikeData.songs = [1];
  withSong.data.likeSongsList.data = [song(1)];
  withSong.data.likeSongsList.detail.count = 1;
  const withAlbum = structuredClone(baseline);
  withAlbum.data.userLikeData.albums = [{ id: 4, name: "album", cover: "a" }];
  const leftMetadata = createSPlayerOperationMetadata(crypto.randomUUID(), 1, 0);
  const rightMetadata = createSPlayerOperationMetadata(crypto.randomUUID(), 1, 0);
  const [leftOperation, rightOperation] = await Promise.all([
    encryptSPlayerOperation(
      accountId,
      { schemaVersion: 1, mutations: diffVaultSnapshots(baseline, withSong) },
      leftMetadata,
      encrypted.vaultKey,
    ),
    encryptSPlayerOperation(
      accountId,
      { schemaVersion: 1, mutations: diffVaultSnapshots(baseline, withAlbum) },
      rightMetadata,
      encrypted.vaultKey,
    ),
  ]);
  const appendResponses = await Promise.all(
    [leftOperation, rightOperation].map((encryptedOperation) =>
      app.inject({
        method: "POST",
        url: "/api/splayer/sync/operations",
        headers: { cookie },
        payload: { operations: [encryptedOperation] },
      }),
    ),
  );
  assert.deepEqual(
    appendResponses.map((response) => response.statusCode),
    [200, 200],
  );

  const pull = await app.inject({
    method: "GET",
    url: "/api/splayer/sync/operations?after=0",
    headers: { cookie },
  });
  assert.equal(pull.statusCode, 200);
  const remoteOperations = await Promise.all(
    pull
      .json()
      .operations.map(async (encryptedOperation: typeof leftOperation & { cursor: number }) => ({
        metadata: {
          operationId: encryptedOperation.operationId,
          deviceId: encryptedOperation.deviceId,
          deviceSeq: encryptedOperation.deviceSeq,
          baseCursor: encryptedOperation.baseCursor,
        },
        cursor: encryptedOperation.cursor,
        payload: await decryptSPlayerOperation(accountId, encryptedOperation, encrypted.vaultKey),
      })),
  );
  const versions = createBaselineVersionTable(baseline, 0);
  const leftResult = applySPlayerOperations(baseline, versions, remoteOperations);
  const rightResult = applySPlayerOperations(baseline, versions, [...remoteOperations].reverse());
  assert.deepEqual(leftResult, rightResult);
  assert.deepEqual(leftResult.snapshot.data.userLikeData.songs, [1]);
  assert.deepEqual(
    leftResult.snapshot.data.userLikeData.albums.map((album) => album.id),
    [4],
  );
});

test("真并发增删由删除获胜，因果后写可重新添加", () => {
  const baseline = fullSnapshot();
  const versions = createBaselineVersionTable(baseline, 0);
  const removed = structuredClone(baseline);
  removed.data.userLikeData.songs = [];
  removed.data.likeSongsList.data = [];
  removed.data.likeSongsList.detail.count = 0;
  const updated = structuredClone(baseline);
  updated.data.likeSongsList.data = [song(1, "updated")];

  const deletion = operation(baseline, removed, metadata("delete", 1), 1);
  const addition = operation(baseline, updated, metadata("put", 1), 2);
  for (const operations of [
    [deletion, addition],
    [addition, deletion],
  ]) {
    const result = applySPlayerOperations(baseline, versions, operations);
    assert.deepEqual(result.snapshot.data.userLikeData.songs, []);
  }

  const deleted = applySPlayerOperations(baseline, versions, [deletion]);
  const restoredSnapshot = structuredClone(deleted.snapshot);
  restoredSnapshot.data.userLikeData.songs = [1];
  restoredSnapshot.data.likeSongsList.data = [song(1, "restored")];
  restoredSnapshot.data.likeSongsList.detail.count = 1;
  const restoration = operation(deleted.snapshot, restoredSnapshot, metadata("restore", 1, 1), 2);
  const restored = applySPlayerOperations(deleted.snapshot, deleted.versions, [restoration]);
  assert.deepEqual(restored.snapshot.data.userLikeData.songs, [1]);
});

test("私人歌单并发加歌逐成员合并", () => {
  const baseline = emptySnapshot();
  baseline.local.localPlaylists = [
    { id: 100, name: "private", songs: [], createTime: 1, updateTime: 1 },
  ];
  const versions = createBaselineVersionTable(baseline, 0);
  const first = structuredClone(baseline);
  first.local.localPlaylists[0].songs = ["11"];
  first.local.playlistSongs = [song(11)];
  const second = structuredClone(baseline);
  second.local.localPlaylists[0].songs = ["12"];
  second.local.playlistSongs = [song(12)];

  const firstOperation = operation(baseline, first, metadata("first", 1), 1);
  const secondOperation = operation(baseline, second, metadata("second", 1), 2);
  const result = applySPlayerOperations(baseline, versions, [secondOperation, firstOperation]);
  assert.deepEqual(result.snapshot.local.localPlaylists[0].songs, ["11", "12"]);
  assert.deepEqual(
    result.snapshot.local.playlistSongs.map((item) => item.id),
    [11, 12],
  );
});

test("操作加密绑定账户和全部外层元数据并拒绝篡改", async () => {
  const key = new Uint8Array(32).fill(7);
  const operationMetadata = metadata("device", 3, 8);
  const payload = {
    schemaVersion: 1 as const,
    mutations: vaultSnapshotToMutations(fullSnapshot()),
  };
  const encrypted = await encryptSPlayerOperation("account-a", payload, operationMetadata, key);
  assert.deepEqual(await decryptSPlayerOperation("account-a", encrypted, key), payload);

  for (const tampered of [
    { ...encrypted, deviceSeq: encrypted.deviceSeq + 1 },
    { ...encrypted, deviceId: `${encrypted.deviceId}-changed` },
    { ...encrypted, baseCursor: encrypted.baseCursor + 1 },
    { ...encrypted, operationId: `${encrypted.operationId}-changed` },
    {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -1)}${encrypted.ciphertext.endsWith("A") ? "B" : "A"}`,
    },
  ]) {
    await assert.rejects(() => decryptSPlayerOperation("account-a", tampered, key));
  }
  await assert.rejects(() => decryptSPlayerOperation("account-b", encrypted, key));
  await assert.rejects(() =>
    decryptSPlayerOperation("account-a", encrypted, new Uint8Array(32).fill(8)),
  );
});

test("上传操作按条数和请求体字节限制拆批", () => {
  const createEncryptedOperation = (id: number, ciphertextLength: number) => ({
    ...metadata(crypto.randomUUID(), id),
    nonce: "A".repeat(16),
    ciphertext: "B".repeat(ciphertextLength),
  });
  const operations = [
    createEncryptedOperation(1, 80),
    createEncryptedOperation(2, 80),
    createEncryptedOperation(3, 80),
  ];

  const byCount = createSPlayerOperationBatches(operations, 2, 10_000);
  assert.deepEqual(
    byCount.map((batch) => batch.length),
    [2, 1],
  );

  const singleBytes = new TextEncoder().encode(
    JSON.stringify({ operations: [operations[0]] }),
  ).byteLength;
  const byBytes = createSPlayerOperationBatches(operations, 10, singleBytes + 1);
  assert.deepEqual(
    byBytes.map((batch) => batch.length),
    [1, 1, 1],
  );
});

test("删除版本保留为 tombstone", () => {
  const baseline = fullSnapshot();
  const versions = createBaselineVersionTable(baseline, 0);
  const removed = structuredClone(baseline);
  removed.data.userLikeData.albums = [];
  const deletion = operation(baseline, removed, metadata("delete", 1), 1);
  const result = applySPlayerOperations(baseline, versions, [deletion]);
  const tombstones = Object.values(result.versions).filter((version) => version.deleted);
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].operationId, "delete:1");
});
