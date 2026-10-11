import type {
  EncryptedSPlayerOperation,
  SPlayerAccountMutation,
  SPlayerEntityVersion,
  SPlayerMutationCollection,
  SPlayerOperationMetadata,
  SPlayerOperationPayload,
  SPlayerVaultSnapshot,
  SPlayerVersionTable,
} from "@/types/account";
import type { CoverType, LocalPlaylistType, SongType } from "@/types/main";

interface PositionedValue<T> {
  item: T;
  position: string;
}

interface FavoriteSongValue {
  id: number | string;
  song?: SongType;
  position: string;
}

interface PrivatePlaylistValue {
  playlist: Omit<LocalPlaylistType, "songs">;
  position: string;
}

interface PrivatePlaylistMemberValue {
  playlistId: number;
  songId: string;
  position: string;
}

export interface SPlayerDecryptedOperation {
  metadata: SPlayerOperationMetadata;
  payload: SPlayerOperationPayload;
  cursor?: number;
}

export interface SPlayerMutationResult {
  snapshot: SPlayerVaultSnapshot;
  versions: SPlayerVersionTable;
}

const POSITION_WIDTH = 12;
const MAX_APPEND_REQUEST_BYTES = 4 * 1024 * 1024;

const createUuid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const clone = <T>(value: T): T => structuredClone(value);

/** 按服务端条数和请求体字节限制拆分待上传操作 */
export const createSPlayerOperationBatches = (
  operations: readonly EncryptedSPlayerOperation[],
  maximumOperations: number,
  maximumBytes = MAX_APPEND_REQUEST_BYTES,
): EncryptedSPlayerOperation[][] => {
  const batches: EncryptedSPlayerOperation[][] = [];
  let batch: EncryptedSPlayerOperation[] = [];
  for (const operation of operations) {
    const candidate = [...batch, operation];
    const exceedsCount = candidate.length > maximumOperations;
    const exceedsBytes =
      new TextEncoder().encode(JSON.stringify({ operations: candidate })).byteLength > maximumBytes;
    if (batch.length > 0 && (exceedsCount || exceedsBytes)) {
      batches.push(batch);
      batch = [operation];
    } else {
      batch = candidate;
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};

const positionForIndex = (index: number) => index.toString(36).padStart(POSITION_WIDTH, "0");

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
};

const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));

export const getSPlayerMutationKey = (collection: SPlayerMutationCollection, entityId: string) =>
  JSON.stringify([collection, entityId]);

export const createSPlayerOperationMetadata = (
  deviceId: string,
  deviceSeq: number,
  baseCursor: number,
): SPlayerOperationMetadata => ({
  operationId: createUuid(),
  deviceId,
  deviceSeq,
  baseCursor,
});

const getEntityId = (value: number | string) => String(value);

const getPairId = (left: number | string, right: number | string) =>
  JSON.stringify([String(left), String(right)]);

const snapshotEntityMap = (snapshot: SPlayerVaultSnapshot) => {
  const entities = new Map<string, SPlayerAccountMutation>();
  const put = (collection: SPlayerMutationCollection, entityId: string, value: unknown) => {
    const mutation: SPlayerAccountMutation = { collection, entityId, action: "put", value };
    entities.set(getSPlayerMutationKey(collection, entityId), mutation);
  };

  const likedSongs = new Map(
    snapshot.data.likeSongsList.data.map((song) => [String(song.id), song]),
  );
  snapshot.data.userLikeData.songs.forEach((id, index) => {
    put("favorite-song", getEntityId(id), {
      id,
      song: likedSongs.get(String(id)),
      position: positionForIndex(index),
    } satisfies FavoriteSongValue);
  });
  put("favorite-song-list", "detail", clone(snapshot.data.likeSongsList.detail));

  const favoriteCollections = [
    ["favorite-playlist", snapshot.data.userLikeData.playlists],
    ["favorite-album", snapshot.data.userLikeData.albums],
    ["favorite-artist", snapshot.data.userLikeData.artists],
    ["favorite-mv", snapshot.data.userLikeData.mvs],
    ["favorite-podcast", snapshot.data.userLikeData.djs],
  ] as const;
  for (const [collection, items] of favoriteCollections) {
    items.forEach((item, index) => {
      put(collection, getEntityId(item.id), {
        item: clone(item),
        position: positionForIndex(index),
      });
    });
  }

  snapshot.local.localPlaylists.forEach((playlist, index) => {
    const { songs, ...metadata } = playlist;
    put("private-playlist", String(playlist.id), {
      playlist: clone(metadata),
      position: positionForIndex(index),
    } satisfies PrivatePlaylistValue);
    songs.forEach((songId, songIndex) => {
      put("private-playlist-member", getPairId(playlist.id, songId), {
        playlistId: playlist.id,
        songId,
        position: positionForIndex(songIndex),
      } satisfies PrivatePlaylistMemberValue);
    });
  });
  snapshot.local.playlistSongs.forEach((song, index) => {
    put("playlist-song", String(song.id), {
      item: clone(song),
      position: positionForIndex(index),
    } satisfies PositionedValue<SongType>);
  });
  snapshot.data.historyList.forEach((song, index) => {
    put("history", String(song.id), {
      item: clone(song),
      position: positionForIndex(index),
    } satisfies PositionedValue<SongType>);
  });

  if (snapshot.preferences) {
    for (const [key, value] of Object.entries(snapshot.preferences.setting)) {
      put("setting", key, clone(value));
    }
    for (const [key, value] of Object.entries(snapshot.preferences.status)) {
      put("status", key, clone(value));
    }
    for (const [key, value] of Object.entries(snapshot.preferences.shortcut)) {
      put("shortcut", key, value);
    }
  }
  put("queue", "playList", clone(snapshot.data.playList));
  put("queue", "originalPlayList", clone(snapshot.data.originalPlayList));
  return entities;
};

const compareMutations = (left: SPlayerAccountMutation, right: SPlayerAccountMutation) =>
  compareText(
    getSPlayerMutationKey(left.collection, left.entityId),
    getSPlayerMutationKey(right.collection, right.entityId),
  );

/** 将完整快照转换为实体级写入操作 */
export const vaultSnapshotToMutations = (
  snapshot: SPlayerVaultSnapshot,
): SPlayerAccountMutation[] => [...snapshotEntityMap(snapshot).values()].sort(compareMutations);

/** 计算两个快照之间的实体级变更 */
export const diffVaultSnapshots = (
  previous: SPlayerVaultSnapshot,
  current: SPlayerVaultSnapshot,
): SPlayerAccountMutation[] => {
  const before = snapshotEntityMap(previous);
  const after = snapshotEntityMap(current);
  const mutations: SPlayerAccountMutation[] = [];
  for (const [key, mutation] of after) {
    if (!valuesEqual(before.get(key)?.value, mutation.value)) mutations.push(mutation);
  }
  for (const [key, mutation] of before) {
    if (!after.has(key)) {
      mutations.push({
        collection: mutation.collection,
        entityId: mutation.entityId,
        action: "delete",
      });
    }
  }
  return mutations.sort(compareMutations);
};

const operationRank = (version: SPlayerOperationMetadata) =>
  JSON.stringify([
    version.deviceId,
    version.deviceSeq.toString().padStart(16, "0"),
    version.operationId,
  ]);

const isIncomingWinner = (
  current: SPlayerEntityVersion | undefined,
  incoming: SPlayerEntityVersion,
) => {
  if (!current) return true;
  if (current.operationId === incoming.operationId) return false;
  if (current.deviceId === incoming.deviceId && current.deviceSeq !== incoming.deviceSeq) {
    return incoming.deviceSeq > current.deviceSeq;
  }
  if (current.cursor !== undefined && incoming.baseCursor >= current.cursor) return true;
  if (incoming.cursor !== undefined && current.baseCursor >= incoming.cursor) return false;
  if (current.deleted !== incoming.deleted) return incoming.deleted;
  return compareText(operationRank(incoming), operationRank(current)) > 0;
};

const ensurePreferences = (snapshot: SPlayerVaultSnapshot) => {
  snapshot.preferences ??= { schemaVersion: 1, setting: {}, status: {}, shortcut: {} };
  return snapshot.preferences;
};

const removeById = <T extends { id: number | string }>(items: T[], entityId: string) => {
  const index = items.findIndex((item) => String(item.id) === entityId);
  if (index !== -1) items.splice(index, 1);
};

const applyMutationValue = (snapshot: SPlayerVaultSnapshot, mutation: SPlayerAccountMutation) => {
  const deleting = mutation.action === "delete";
  switch (mutation.collection) {
    case "favorite-song": {
      snapshot.data.userLikeData.songs = snapshot.data.userLikeData.songs.filter(
        (id) => String(id) !== mutation.entityId,
      );
      removeById(snapshot.data.likeSongsList.data, mutation.entityId);
      if (!deleting) {
        const value = clone(mutation.value) as FavoriteSongValue;
        snapshot.data.userLikeData.songs.push(value.id);
        if (value.song) snapshot.data.likeSongsList.data.push(value.song);
      }
      break;
    }
    case "favorite-song-list":
      if (!deleting) snapshot.data.likeSongsList.detail = clone(mutation.value) as CoverType;
      break;
    case "favorite-playlist":
    case "favorite-album":
    case "favorite-artist":
    case "favorite-mv":
    case "favorite-podcast": {
      const property = {
        "favorite-playlist": "playlists",
        "favorite-album": "albums",
        "favorite-artist": "artists",
        "favorite-mv": "mvs",
        "favorite-podcast": "djs",
      }[mutation.collection] as "playlists";
      const items = snapshot.data.userLikeData[property] as Array<{ id: number | string }>;
      removeById(items, mutation.entityId);
      if (!deleting) {
        const value = clone(mutation.value) as PositionedValue<{ id: number | string }>;
        items.push(value.item);
      }
      break;
    }
    case "private-playlist": {
      const existing = snapshot.local.localPlaylists.find(
        (playlist) => String(playlist.id) === mutation.entityId,
      );
      removeById(snapshot.local.localPlaylists, mutation.entityId);
      if (!deleting) {
        const value = clone(mutation.value) as PrivatePlaylistValue;
        snapshot.local.localPlaylists.push({ ...value.playlist, songs: existing?.songs ?? [] });
      }
      break;
    }
    case "private-playlist-member": {
      const value = clone(mutation.value) as PrivatePlaylistMemberValue | undefined;
      const pair = value ?? (JSON.parse(mutation.entityId) as [string, string]);
      const playlistId = "playlistId" in pair ? pair.playlistId : pair[0];
      const songId = "songId" in pair ? pair.songId : pair[1];
      const playlist = snapshot.local.localPlaylists.find(
        (item) => String(item.id) === String(playlistId),
      );
      if (playlist) {
        playlist.songs = playlist.songs.filter((id) => id !== String(songId));
        if (!deleting) playlist.songs.push(String(songId));
      }
      break;
    }
    case "playlist-song":
    case "history": {
      const items =
        mutation.collection === "playlist-song"
          ? snapshot.local.playlistSongs
          : snapshot.data.historyList;
      removeById(items, mutation.entityId);
      if (!deleting) {
        const value = clone(mutation.value) as PositionedValue<SongType>;
        items.push(value.item);
      }
      break;
    }
    case "setting":
    case "status":
    case "shortcut": {
      const preferences = ensurePreferences(snapshot);
      const target = preferences[mutation.collection];
      if (deleting) delete target[mutation.entityId];
      else target[mutation.entityId] = clone(mutation.value) as never;
      break;
    }
    case "queue":
      if (
        !deleting &&
        (mutation.entityId === "playList" || mutation.entityId === "originalPlayList")
      ) {
        snapshot.data[mutation.entityId] = clone(mutation.value) as SongType[];
      }
      break;
  }
};

const getPosition = (
  versions: SPlayerVersionTable,
  collection: SPlayerMutationCollection,
  entityId: string,
) => {
  const value = versions[getSPlayerMutationKey(collection, entityId)]?.value as
    | { position?: unknown }
    | undefined;
  return typeof value?.position === "string" ? value.position : "";
};

const compareEntityPosition = (
  versions: SPlayerVersionTable,
  collection: SPlayerMutationCollection,
  leftId: string,
  rightId: string,
) =>
  compareText(
    getPosition(versions, collection, leftId),
    getPosition(versions, collection, rightId),
  ) || compareText(leftId, rightId);

const normalizeSnapshotOrder = (snapshot: SPlayerVaultSnapshot, versions: SPlayerVersionTable) => {
  const sortItems = <T extends { id: number | string }>(
    items: T[],
    collection: SPlayerMutationCollection,
  ) =>
    items.sort((left, right) =>
      compareEntityPosition(versions, collection, String(left.id), String(right.id)),
    );
  snapshot.data.userLikeData.songs.sort((left, right) =>
    compareEntityPosition(versions, "favorite-song", String(left), String(right)),
  );
  sortItems(snapshot.data.likeSongsList.data, "favorite-song");
  sortItems(snapshot.data.userLikeData.playlists, "favorite-playlist");
  sortItems(snapshot.data.userLikeData.albums, "favorite-album");
  sortItems(snapshot.data.userLikeData.artists, "favorite-artist");
  sortItems(snapshot.data.userLikeData.mvs, "favorite-mv");
  sortItems(snapshot.data.userLikeData.djs, "favorite-podcast");
  sortItems(snapshot.local.localPlaylists, "private-playlist");
  sortItems(snapshot.local.playlistSongs, "playlist-song");
  sortItems(snapshot.data.historyList, "history");
  for (const playlist of snapshot.local.localPlaylists) {
    playlist.songs.sort((left, right) =>
      compareEntityPosition(
        versions,
        "private-playlist-member",
        getPairId(playlist.id, left),
        getPairId(playlist.id, right),
      ),
    );
  }
  snapshot.data.likeSongsList.detail.count = snapshot.data.userLikeData.songs.length;
};

/** 应用一批带版本的实体操作 */
export const applyAccountMutations = (
  source: SPlayerVaultSnapshot,
  sourceVersions: SPlayerVersionTable,
  mutations: readonly SPlayerAccountMutation[],
  metadata: SPlayerOperationMetadata,
  cursor?: number,
): SPlayerMutationResult => {
  const snapshot = clone(source);
  const versions = clone(sourceVersions);
  for (const mutation of mutations) {
    const key = getSPlayerMutationKey(mutation.collection, mutation.entityId);
    const current = versions[key];
    const incoming: SPlayerEntityVersion = {
      ...metadata,
      cursor,
      deleted: mutation.action === "delete",
      value: mutation.action === "put" ? clone(mutation.value) : undefined,
    };
    if (current?.operationId === incoming.operationId) {
      if (incoming.cursor !== undefined && current.cursor === undefined) {
        current.cursor = incoming.cursor;
        applyMutationValue(snapshot, mutation);
      }
      continue;
    }
    if (!isIncomingWinner(current, incoming)) continue;
    applyMutationValue(snapshot, mutation);
    versions[key] = incoming;
  }
  normalizeSnapshotOrder(snapshot, versions);
  return { snapshot, versions };
};

/** 以任意顺序应用操作，结果由因果关系和稳定排序决定 */
export const applySPlayerOperations = (
  source: SPlayerVaultSnapshot,
  sourceVersions: SPlayerVersionTable,
  operations: readonly SPlayerDecryptedOperation[],
): SPlayerMutationResult => {
  let result: SPlayerMutationResult = { snapshot: clone(source), versions: clone(sourceVersions) };
  for (const operation of operations) {
    result = applyAccountMutations(
      result.snapshot,
      result.versions,
      operation.payload.mutations,
      operation.metadata,
      operation.cursor,
    );
  }
  return result;
};

/** 为旧 schema 1 快照建立同步基线版本表 */
export const createBaselineVersionTable = (
  snapshot: SPlayerVaultSnapshot,
  baselineCursor: number,
): SPlayerVersionTable => {
  if (snapshot.schemaVersion !== 1) throw new Error("不支持的保险库基线格式");
  const metadata: SPlayerOperationMetadata = {
    operationId: "00000000-0000-4000-8000-000000000000",
    deviceId: "baseline",
    deviceSeq: 0,
    baseCursor: baselineCursor,
  };
  return Object.fromEntries(
    vaultSnapshotToMutations(snapshot).map((mutation) => [
      getSPlayerMutationKey(mutation.collection, mutation.entityId),
      {
        ...metadata,
        cursor: baselineCursor,
        deleted: false,
        value: clone(mutation.value),
      } satisfies SPlayerEntityVersion,
    ]),
  );
};
