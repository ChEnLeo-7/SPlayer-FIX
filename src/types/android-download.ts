export type AndroidDownloadStatus =
  | "queued"
  | "downloading"
  | "conflict"
  | "completed"
  | "failed"
  | "cancelled";

export type AndroidDuplicatePolicy = "ask" | "replace" | "rename";

export interface AndroidDownloadMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  year?: string;
  track?: string;
}

export interface AndroidDownloadRequest {
  taskId: string;
  clientKey: string;
  url: string;
  fileName: string;
  extension: "mp3" | "flac";
  mimeType: "audio/mpeg" | "audio/flac";
  duplicatePolicy: AndroidDuplicatePolicy;
  metadata?: AndroidDownloadMetadata;
}

export interface AndroidDownloadTask extends AndroidDownloadRequest {
  status: AndroidDownloadStatus;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
  message?: string;
  savedUri?: string;
}

export interface AndroidDownloadPermissionState {
  notifications: "granted" | "denied" | "prompt";
  storage: "granted" | "denied" | "prompt";
}

export interface AndroidDownloadDirectory {
  displayName: string;
  custom: boolean;
  cancelled: boolean;
}

export interface AndroidDownloadRetryRequest {
  taskId: string;
  url?: string;
  extension?: AndroidDownloadRequest["extension"];
  mimeType?: AndroidDownloadRequest["mimeType"];
}
