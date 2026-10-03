import { sPlayerMediaPlugin } from "@/platform/android/mediaPlugin";
import type { AndroidPlaybackEvent } from "@/types/android-media";
import { TypedEventTarget } from "@/utils/TypedEventTarget";
import type { PluginListenerHandle } from "@capacitor/core";
import { AUDIO_EVENTS, type AudioEventMap, AudioErrorCode } from "./BaseAudioPlayer";
import type {
  EngineCapabilities,
  IPlaybackEngine,
  PauseOptions,
  PlayOptions,
} from "./IPlaybackEngine";

export class Media3Player extends TypedEventTarget<AudioEventMap> implements IPlaybackEngine {
  public readonly capabilities: EngineCapabilities = {
    supportsRate: true,
    supportsSinkId: false,
    supportsEqualizer: false,
    supportsSpectrum: false,
  };

  private readyPromise: Promise<void> | null = null;
  private listenerHandle: PluginListenerHandle | null = null;
  private durationSeconds = 0;
  private positionSeconds = 0;
  private isPaused = true;
  private source = "";
  private volume = 1;
  private rate = 1;
  private errorCode = 0;

  public init(): void {
    if (this.readyPromise) return;
    this.readyPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    await sPlayerMediaPlugin.initialize();
    this.listenerHandle = await sPlayerMediaPlugin.addListener("playbackEvent", (event) => {
      this.handleNativeEvent(event);
    });
    this.applyState(await sPlayerMediaPlugin.getState());
  }

  private async ready(): Promise<void> {
    this.init();
    await this.readyPromise;
  }

  private applyState(event: AndroidPlaybackEvent) {
    this.positionSeconds = Math.max(0, event.positionMs) / 1000;
    this.durationSeconds = Math.max(0, event.durationMs) / 1000;
    this.isPaused = !event.playWhenReady;
  }

  private handleNativeEvent(event: AndroidPlaybackEvent) {
    this.applyState(event);
    switch (event.event) {
      case "loadstart":
        this.dispatch(AUDIO_EVENTS.LOAD_START);
        break;
      case "canplay":
        this.dispatch(AUDIO_EVENTS.CAN_PLAY);
        break;
      case "play":
        this.dispatch(AUDIO_EVENTS.PLAY);
        break;
      case "pause":
        this.dispatch(AUDIO_EVENTS.PAUSE);
        break;
      case "waiting":
        this.dispatch(AUDIO_EVENTS.WAITING);
        break;
      case "ended":
        this.dispatch(AUDIO_EVENTS.ENDED);
        break;
      case "emptied":
        this.dispatch(AUDIO_EVENTS.EMPTIED);
        break;
      case "error":
        this.errorCode = event.errorCode ?? AudioErrorCode.NETWORK;
        this.dispatch(AUDIO_EVENTS.ERROR, {
          originalEvent: new Event("error"),
          errorCode: this.errorCode,
        });
        break;
      case "state":
      case "timeupdate":
        this.dispatch(AUDIO_EVENTS.TIME_UPDATE);
        break;
    }
  }

  public destroy(): void {
    void this.listenerHandle?.remove();
    this.listenerHandle = null;
    this.readyPromise = null;
  }

  public async play(url?: string, options: PlayOptions = {}): Promise<void> {
    await this.ready();
    if (!url) {
      await sPlayerMediaPlugin.play();
      return;
    }
    this.source = url;
    const item = options.mediaItem ?? {
      id: url,
      url,
      title: "未知歌曲",
      artist: "未知歌手",
      album: "未知专辑",
    };
    await sPlayerMediaPlugin.loadMedia({
      item: { ...item, url },
      autoPlay: options.autoPlay ?? true,
      positionMs: Math.max(0, options.seek ?? 0) * 1000,
    });
  }

  public async resume(): Promise<void> {
    await this.ready();
    await sPlayerMediaPlugin.play();
  }

  public pause(_options?: PauseOptions): void {
    this.isPaused = true;
    void this.ready().then(() => sPlayerMediaPlugin.pause());
  }

  public stop(): void {
    this.isPaused = true;
    this.positionSeconds = 0;
    this.durationSeconds = 0;
    this.source = "";
    void this.ready().then(() => sPlayerMediaPlugin.stop());
  }

  public seek(time: number): void {
    this.positionSeconds = Math.max(0, time);
    void this.ready().then(() =>
      sPlayerMediaPlugin.seekTo({ positionMs: this.positionSeconds * 1000 }),
    );
  }

  public get duration(): number {
    return this.durationSeconds;
  }

  public get currentTime(): number {
    return this.positionSeconds;
  }

  public get paused(): boolean {
    return this.isPaused;
  }

  public get src(): string {
    return this.source;
  }

  public setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    void this.ready().then(() => sPlayerMediaPlugin.setVolume({ value: this.volume }));
  }

  public getVolume(): number {
    return this.volume;
  }

  public setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(4, rate));
    void this.ready().then(() => sPlayerMediaPlugin.setRate({ value: this.rate }));
  }

  public getRate(): number {
    return this.rate;
  }

  public setAudioDelayCompensation(_offset: number): void {}

  public async setSinkId(_deviceId: string): Promise<void> {}

  public getErrorCode(): number {
    return this.errorCode;
  }
}
