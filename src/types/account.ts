import type { CoverType, LocalPlaylistType, SongType, UserLikeDataType } from "@/types/main";

export type SPlayerAccountStatus = "guest" | "locked" | "authenticated";
export type SPlayerSyncStatus = "idle" | "pending" | "syncing" | "synced" | "conflict" | "error";

export interface SPlayerUser {
  id: number | string;
  username: string;
  mustChangePassword?: boolean;
}

export interface EncryptedValue {
  nonce: string;
  ciphertext: string;
}

export interface SPlayerEncryption {
  kdfSalt: string;
  kdfIterations: number;
  wrappedVaultKey: EncryptedValue;
  recoveryWrappedVaultKey: EncryptedValue;
}

export type SPlayerPasswordEncryption = Pick<
  SPlayerEncryption,
  "kdfSalt" | "kdfIterations" | "wrappedVaultKey"
>;

export interface EncryptedVault extends EncryptedValue {
  schemaVersion: number;
}

export interface DataScopeSnapshot {
  userLikeData: UserLikeDataType;
  likeSongsList: {
    detail: CoverType;
    data: SongType[];
  };
  historyList: SongType[];
  playList: SongType[];
  originalPlayList: SongType[];
}

export interface LocalScopeSnapshot {
  localPlaylists: LocalPlaylistType[];
  playlistSongs: SongType[];
}

export interface SPlayerPreferencesSnapshot {
  schemaVersion: 1;
  setting: Record<string, unknown>;
  status: Record<string, unknown>;
  shortcut: Record<string, string>;
}

export interface SPlayerVaultSnapshot {
  schemaVersion: 1;
  data: DataScopeSnapshot;
  local: LocalScopeSnapshot;
  preferences?: SPlayerPreferencesSnapshot;
}

export interface SPlayerAuthResponse {
  user: SPlayerUser;
  encryption: SPlayerEncryption;
  vault: EncryptedVault;
  revision: number;
  sync?: SPlayerSyncSummary;
}

export interface SPlayerSessionResponse {
  user: SPlayerUser | null;
  encryption?: SPlayerEncryption;
  vault?: EncryptedVault;
  revision?: number;
  sync?: SPlayerSyncSummary;
}

export interface SPlayerRegisterRequest {
  username: string;
  authSecret: string;
  recoveryVerifier: string;
  encryption: SPlayerEncryption;
  vault: EncryptedVault;
}

export interface SPlayerLoginRequest {
  username: string;
  authSecret: string;
}

export interface SPlayerPasswordRequest {
  currentAuthSecret: string;
  newAuthSecret: string;
  passwordEncryption: SPlayerPasswordEncryption;
  recoveryProof?: string;
}

export interface SPlayerVaultUpdateRequest {
  revision: number;
  vault: EncryptedVault;
}

export interface SPlayerVaultResponse {
  vault: EncryptedVault;
  revision: number;
}

export type SPlayerSyncMode = "vault" | "operations";

export interface SPlayerOperationMetadata {
  operationId: string;
  deviceId: string;
  deviceSeq: number;
  baseCursor: number;
}

export interface EncryptedSPlayerOperation extends SPlayerOperationMetadata, EncryptedValue {}

export interface SPlayerCursorOperation extends EncryptedSPlayerOperation {
  cursor: number;
}

export type SPlayerMutationCollection =
  | "favorite-song"
  | "favorite-playlist"
  | "favorite-album"
  | "favorite-artist"
  | "favorite-mv"
  | "favorite-podcast"
  | "favorite-song-list"
  | "private-playlist"
  | "private-playlist-member"
  | "playlist-song"
  | "history"
  | "setting"
  | "status"
  | "shortcut"
  | "queue";

export interface SPlayerAccountMutation {
  collection: SPlayerMutationCollection;
  entityId: string;
  action: "put" | "delete";
  value?: unknown;
}

export interface SPlayerOperationPayload {
  schemaVersion: 1;
  mutations: SPlayerAccountMutation[];
}

export interface SPlayerEntityVersion extends SPlayerOperationMetadata {
  cursor?: number;
  deleted: boolean;
  value?: unknown;
}

export type SPlayerVersionTable = Record<string, SPlayerEntityVersion>;

export interface SPlayerLocalSyncState {
  schemaVersion: 1;
  deviceSeq: number;
  pullCursor: number;
  outbox: EncryptedSPlayerOperation[];
  versions: SPlayerVersionTable;
}

export interface SPlayerSyncSummary {
  protocolVersion: number;
  mode: SPlayerSyncMode;
  headCursor: number;
}

export interface SPlayerSyncLimits {
  maxOperations: number;
  maxBytes: number;
  maxOperationBytes: number;
  maxBatchOperations: number;
  maxPullOperations: number;
}

export interface SPlayerSyncInfo extends SPlayerSyncSummary {
  operationCount: number;
  operationBytes: number;
  limits: SPlayerSyncLimits;
}

export interface SPlayerSyncInfoResponse {
  sync: SPlayerSyncInfo;
}

export interface SPlayerSyncMigrateRequest {
  revision: number;
}

export type SPlayerSyncMigrateResponse = SPlayerSyncInfoResponse;

export interface SPlayerOperationsAppendRequest {
  operations: EncryptedSPlayerOperation[];
}

export interface SPlayerAcceptedOperation {
  operationId: string;
  cursor: number;
  duplicate: boolean;
}

export interface SPlayerOperationsAppendResponse {
  operations: SPlayerAcceptedOperation[];
  headCursor: number;
}

export interface SPlayerOperationsPullRequest {
  after: number;
  limit?: number;
}

export interface SPlayerOperationsPullResponse {
  operations: SPlayerCursorOperation[];
  headCursor: number;
  nextCursor: number;
  hasMore: boolean;
}

export interface SPlayerApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
