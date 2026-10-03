export interface AndroidMediaItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  duration?: number;
}

export type AndroidPlaybackEventType =
  | "state"
  | "loadstart"
  | "canplay"
  | "play"
  | "pause"
  | "waiting"
  | "ended"
  | "emptied"
  | "error"
  | "timeupdate";

export interface AndroidPlaybackEvent {
  event: AndroidPlaybackEventType;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  playWhenReady: boolean;
  playbackState: number;
  errorCode?: number;
  message?: string;
}
