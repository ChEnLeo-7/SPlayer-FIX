import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { isElectron, isNativeAndroid } from "@/utils/env";
import { getPlaySongData } from "@/utils/format";
import { msToS } from "@/utils/time";
import type { SystemMediaEvent } from "@emi";
import type { PluginListenerHandle } from "@capacitor/core";
import { throttle } from "lodash-es";
import { usePlayerController } from "./PlayerController";
import { sPlayerMediaPlugin } from "@/platform/android/mediaPlugin";
import {
  enableDiscordRpc,
  sendMediaMetadata,
  sendMediaPlayMode,
  sendMediaPlayState,
  sendMediaPlaybackRate,
  sendMediaVolume,
  sendMediaTimeline,
  updateDiscordConfig,
} from "./PlayerIpc";

/**
 * 媒体会话管理器，负责不同平台的媒体控制集成
 * 在 Electron 平台上会使用原生插件，Web 平台上会使用 Navigator.mediaSession
 */
class MediaSessionManager {
  private metadataAbortController: AbortController | null = null;
  private currentRate: number = 1;
  private androidNavigationListener: PluginListenerHandle | null = null;

  private throttledSendTimeline = throttle((currentTime: number, duration: number) => {
    sendMediaTimeline(currentTime, duration);
  }, 200);

  /**
   * 是否使用原生媒体集成
   */
  private shouldUseNativeMedia(): boolean {
    return isElectron;
  }

  /**
   * 处理原生来的媒体事件
   */
  private handleMediaEvent(
    event: SystemMediaEvent,
    player: ReturnType<typeof usePlayerController>,
  ) {
    switch (event.type) {
      case "Play":
        player.play();
        break;
      case "Pause":
        player.pause();
        sendMediaPlayState("Paused");
        break;
      case "Stop":
        player.pause();
        player.setSeek(0);
        sendMediaPlayState("Paused");
        break;
      case "NextSong":
        player.nextOrPrev("next");
        break;
      case "PreviousSong":
        player.nextOrPrev("prev");
        break;
      case "Seek":
        if (event.positionMs != null) {
          player.setSeek(event.positionMs);
        }
        break;
      case "ToggleShuffle":
        player.toggleShuffle();
        break;
      case "ToggleRepeat":
        player.toggleRepeat();
        break;
      case "SetRate":
        if (event.rate != null) {
          player.setRate(event.rate);
        }
        break;
      case "SetVolume":
        if (event.volume != null) {
          player.setVolume(event.volume);
        }
        break;
    }
  }

  /**
   * 初始化媒体会话
   */
  public init() {
    if (isNativeAndroid) {
      if (!this.androidNavigationListener) {
        void sPlayerMediaPlugin
          .addListener("navigation", ({ direction }) => {
            void usePlayerController().nextOrPrev(direction === "next" ? "next" : "prev");
          })
          .then((listener) => {
            this.androidNavigationListener = listener;
          });
      }
      return;
    }
    const settingStore = useSettingStore();
    if (!settingStore.smtcOpen) return;

    const player = usePlayerController();
    const statusStore = useStatusStore();

    this.currentRate = statusStore.playRate;

    if (isElectron) {
      window.electron.ipcRenderer.removeAllListeners("media-event");
      window.electron.ipcRenderer.on("media-event", (_, event) => {
        this.handleMediaEvent(event, player);
      });

      // 同步初始播放模式状态
      const shuffle = statusStore.shuffleMode !== "off";
      const repeat =
        statusStore.repeatMode === "list"
          ? "List"
          : statusStore.repeatMode === "one"
            ? "Track"
            : "None";
      sendMediaPlayMode(shuffle, repeat);
      player.syncMediaPlayMode();

      // 同步初始播放速率
      sendMediaPlaybackRate(statusStore.playRate);

      // Discord RPC 初始化
      if (settingStore.discordRpc.enabled) {
        enableDiscordRpc();
        updateDiscordConfig({
          showWhenPaused: settingStore.discordRpc.showWhenPaused,
          displayMode: settingStore.discordRpc.displayMode,
        });
      }

      // 如果有原生集成则不需要 Web API
      if (settingStore.smtcOpen) return;
    }

    // Web API 初始化
    if ("mediaSession" in navigator) {
      const nav = navigator.mediaSession;
      const setActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
        try {
          nav.setActionHandler(action, handler);
        } catch (error) {
          console.warn(`[Media Session] 当前浏览器不支持 ${action} 操作`, error);
        }
      };

      setActionHandler("play", () => void player.play());
      setActionHandler("pause", () => void player.pause());
      setActionHandler("stop", () => {
        void player.pause();
        player.setSeek(0);
        nav.playbackState = "paused";
      });
      setActionHandler("previoustrack", () => void player.nextOrPrev("prev"));
      setActionHandler("nexttrack", () => void player.nextOrPrev("next"));
      setActionHandler("seekbackward", (event) => {
        player.seekBy(-(event.seekOffset ?? 10) * 1000);
      });
      setActionHandler("seekforward", (event) => {
        player.seekBy((event.seekOffset ?? 10) * 1000);
      });
      setActionHandler("seekto", (event) => {
        if (typeof event.seekTime === "number") player.setSeek(event.seekTime * 1000);
      });
      nav.playbackState = statusStore.playStatus ? "playing" : "paused";
    }
  }

  /**
   * 更新元数据
   */
  public async updateMetadata() {
    if (isNativeAndroid) return;
    if (!("mediaSession" in navigator) && !isElectron) return;
    const musicStore = useMusicStore();
    const settingStore = useSettingStore();
    const song = getPlaySongData();
    if (!song) return;
    if (this.metadataAbortController) {
      this.metadataAbortController.abort();
    }
    this.metadataAbortController = new AbortController();
    const { signal } = this.metadataAbortController;
    const metadata = this.buildMetadata(song);
    // 原生插件
    if (this.shouldUseNativeMedia() && settingStore.smtcOpen) {
      try {
        let coverBuffer: Uint8Array | undefined;
        // 本地文件且封面不是 Blob URL
        if (song.path && !metadata.coverUrl.startsWith("blob:")) {
          try {
            const coverData = await window.electron.ipcRenderer.invoke(
              "get-music-cover",
              song.path,
            );
            if (coverData?.data && !signal.aborted) {
              coverBuffer = new Uint8Array(coverData.data);
            }
          } catch {
            // 忽略读取失败
          }
        }
        // 在线歌曲
        else if (
          metadata.coverUrl &&
          (metadata.coverUrl.startsWith("http") || metadata.coverUrl.startsWith("blob:"))
        ) {
          try {
            const resp = await fetch(metadata.coverUrl, { signal });
            coverBuffer = new Uint8Array(await resp.arrayBuffer());
          } catch {
            // 忽略下载失败
          }
        }
        sendMediaMetadata({
          songName: metadata.title,
          authorName: metadata.artist,
          albumName: metadata.album,
          originalCoverUrl: metadata.coverUrl,
          coverData: coverBuffer as Buffer,
          duration: song.duration,
          ncmId: typeof song.id === "number" ? song.id : undefined,
        });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          console.error("[Media] 更新元数据失败", e);
        }
      } finally {
        if (this.metadataAbortController?.signal === signal) {
          this.metadataAbortController = null;
        }
      }
      return;
    }

    // Web API
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          artwork: this.buildArtwork(musicStore),
        });
      } catch (error) {
        console.warn("[Media Session] 更新媒体通知信息失败", error);
      }
    }
  }

  /**
   * 构建元数据
   */
  private buildMetadata(song: ReturnType<typeof getPlaySongData>): {
    title: string;
    artist: string;
    album: string;
    coverUrl: string;
  } {
    const isRadio = song!.type === "radio";
    const musicStore = useMusicStore();

    return {
      title: song!.name,
      artist: isRadio
        ? song!.dj?.creator || "未知播客"
        : Array.isArray(song!.artists)
          ? song!.artists.map((a) => a.name).join("/")
          : String(song!.artists),
      album: isRadio
        ? song!.dj?.name || "未知播客"
        : typeof song!.album === "object"
          ? song!.album.name
          : String(song!.album),
      coverUrl: musicStore.getSongCover("xl") || musicStore.playSong.cover || "",
    };
  }

  /**
   * 构建专辑封面数组
   */
  private buildArtwork(musicStore: ReturnType<typeof useMusicStore>) {
    const fallback = musicStore.playSong.cover || "";
    const artwork = [
      [musicStore.getSongCover("s") || fallback, "100x100"],
      [musicStore.getSongCover("m") || fallback, "300x300"],
      [musicStore.getSongCover("cover") || fallback, "512x512"],
      [musicStore.getSongCover("l") || fallback, "1024x1024"],
      [musicStore.getSongCover("xl") || fallback, "1920x1920"],
    ];
    return artwork.filter(([src]) => Boolean(src)).map(([src, sizes]) => ({ src, sizes }));
  }

  /**
   * 更新播放进度
   * @param duration 总时长
   * @param position 当前位置
   * @param immediate 是否立即发送，用于 Seek 操作
   */
  public updateState(duration: number, position: number, immediate: boolean = false) {
    if (isNativeAndroid) return;
    const settingStore = useSettingStore();
    if (!settingStore.smtcOpen) return;

    // 原生插件
    if (this.shouldUseNativeMedia()) {
      if (immediate) {
        this.throttledSendTimeline.cancel();
        // 绝对位置更新，避免 Seek 操作的进度更新被限流丢弃
        sendMediaTimeline(position, duration, true);
      } else {
        this.throttledSendTimeline(position, duration);
      }
      return;
    }

    // Web API
    this.throttledUpdatePositionState(duration, position);
  }

  /**
   * 更新播放状态
   */
  public updatePlaybackStatus(isPlaying: boolean) {
    if (isNativeAndroid) return;
    // 发送到原生插件
    if (this.shouldUseNativeMedia()) {
      sendMediaPlayState(isPlaying ? "Playing" : "Paused");
      return;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }

  /**
   * 更新播放速率
   */
  public updatePlaybackRate(rate: number) {
    if (isNativeAndroid) return;
    this.currentRate = rate;

    if (this.shouldUseNativeMedia()) {
      sendMediaPlaybackRate(rate);
    }
  }

  public updateVolume(volume: number) {
    if (isNativeAndroid) return;
    if (this.shouldUseNativeMedia()) {
      sendMediaVolume(volume);
    }
  }

  /**
   * 限流更新进度状态
   */
  private throttledUpdatePositionState = throttle((duration: number, position: number) => {
    if (!("mediaSession" in navigator)) return;
    const durationSeconds = msToS(duration);
    const positionSeconds = msToS(position);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isFinite(positionSeconds) ||
      !Number.isFinite(this.currentRate) ||
      this.currentRate <= 0
    ) {
      return;
    }
    try {
      navigator.mediaSession.setPositionState({
        duration: durationSeconds,
        position: Math.max(0, Math.min(positionSeconds, durationSeconds)),
        playbackRate: this.currentRate,
      });
    } catch (error) {
      console.warn("[Media Session] 更新播放进度失败", error);
    }
  }, 1000);
}

export const mediaSessionManager = new MediaSessionManager();
