import type { CoverType, LocalPlaylistType, SongType, UserLikeDataType } from "@/types/main";

export type SPlayerAccountStatus = "guest" | "locked" | "authenticated";
export type SPlayerSyncStatus = "idle" | "syncing" | "synced" | "conflict" | "error";

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
}

export interface SPlayerSessionResponse {
  user: SPlayerUser | null;
  encryption?: SPlayerEncryption;
  vault?: EncryptedVault;
  revision?: number;
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

export interface SPlayerApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
