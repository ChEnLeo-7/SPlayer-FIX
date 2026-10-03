import type { AndroidMediaItem, AndroidPlaybackEvent } from "@/types/android-media";
import type { SongType } from "@/types/main";
import { getPlayerInfoObj } from "@/utils/format";
import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";

interface SPlayerMediaPlugin {
  initialize(): Promise<void>;
  loadMedia(options: {
    item: AndroidMediaItem;
    autoPlay: boolean;
    positionMs: number;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekTo(options: { positionMs: number }): Promise<void>;
  setVolume(options: { value: number }): Promise<void>;
  setRate(options: { value: number }): Promise<void>;
  getState(): Promise<AndroidPlaybackEvent>;
  addListener(
    eventName: "playbackEvent",
    listener: (event: AndroidPlaybackEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "navigation",
    listener: (event: { direction: "next" | "previous" }) => void,
  ): Promise<PluginListenerHandle>;
}

export const sPlayerMediaPlugin = registerPlugin<SPlayerMediaPlugin>("SPlayerMedia");

export const createAndroidMediaItem = (song: SongType, url: string): AndroidMediaItem => {
  const info = getPlayerInfoObj(song) ?? {
    name: song.name || "未知歌曲",
    artist: "未知歌手",
    album: "未知专辑",
  };
  const artwork = song.coverSize?.xl || song.cover || "";
  let artworkUrl: string | undefined;
  if (artwork && !artwork.startsWith("blob:")) {
    try {
      artworkUrl = new URL(artwork, window.location.href).href;
    } catch {
      artworkUrl = undefined;
    }
  }
  return {
    id: String(song.originalId ?? song.id),
    url,
    title: info.name,
    artist: info.artist,
    album: info.album,
    artworkUrl,
    duration: song.duration,
  };
};
