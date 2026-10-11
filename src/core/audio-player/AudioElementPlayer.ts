import {
  AUDIO_EVENTS,
  AudioErrorCode,
  BaseAudioPlayer,
  type AudioEventType,
} from "./BaseAudioPlayer";
import type { EngineCapabilities, FadeCurve } from "./IPlaybackEngine";
import { useSettingStore } from "@/stores";

/**
 * 基于 HTMLAudioElement 的播放器实现
 *
 * 使用原生 HTML5 Audio 元素进行音频播放，支持大多数常见格式
 * 通过 MediaElementAudioSourceNode 连接到 Web Audio API 音频图谱
 */
export class AudioElementPlayer extends BaseAudioPlayer {
  /** 内部 Audio 元素 */
  private audioElement: HTMLAudioElement;
  /** 接入 Web Audio 图谱的 Audio 元素 */
  private readonly graphAudioElement: HTMLAudioElement;
  /** MediaElementAudioSourceNode 用于连接 Web Audio API */
  private sourceNode: MediaElementAudioSourceNode | null = null;
  /** 当前输出设备 */
  private sinkId = "default";
  /** 直连回退任务 */
  private directPlaybackPromise: Promise<void> | null = null;

  /** Seek 锁，用于在 seek 过程中返回稳定的 currentTime */
  private isInternalSeeking = false;
  /** 目标时间缓存，用于在 seek 过程中返回稳定的 currentTime */
  private targetSeekTime = 0;

  /** 引擎能力描述 */
  public override readonly capabilities: EngineCapabilities = {
    supportsRate: true,
    supportsSinkId: true,
    supportsEqualizer: true,
    supportsSpectrum: true,
  };

  constructor() {
    super();
    this.graphAudioElement = new Audio();
    this.graphAudioElement.crossOrigin = "anonymous";
    this.audioElement = this.graphAudioElement;
    this.bindInternalEvents(this.graphAudioElement);
  }

  /**
   * 当音频图谱初始化完成时调用
   * 创建 MediaElementAudioSourceNode 并连接到输入节点
   */
  protected onGraphInitialized(): void {
    if (!this.audioCtx || !this.inputNode) return;

    try {
      if (!this.sourceNode) {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.graphAudioElement);
      } else {
        this.sourceNode.disconnect();
      }

      // 连接: Source -> Input
      this.sourceNode.connect(this.inputNode);
    } catch (error) {
      console.error("[AudioElementPlayer] SourceNode 创建失败", error);
    }
  }

  /**
   * 加载音频资源
   * @param url 音频地址
   */
  public async load(url: string): Promise<void> {
    if (this.audioElement !== this.graphAudioElement) {
      const directAudioElement = this.audioElement;
      this.audioElement = this.graphAudioElement;
      directAudioElement.pause();
      directAudioElement.removeAttribute("src");
      directAudioElement.load();
    }
    this.directPlaybackPromise = null;
    this.audioElement.src = url;
    this.audioElement.load();
  }

  /**
   * 执行底层播放
   * @returns 播放 Promise
   */
  protected async doPlay(): Promise<void> {
    const playbackElement = this.audioElement;
    try {
      await playbackElement.play();
    } catch (error) {
      if (playbackElement !== this.graphAudioElement) throw error;
      if (this.directPlaybackPromise) {
        await this.directPlaybackPromise;
        return;
      }
      if (this.audioElement !== this.graphAudioElement) return;
      if (!this.shouldUseDirectPlayback(error)) throw error;
      await this.startDirectPlayback();
    }
  }

  /**
   * 执行底层暂停
   */
  protected doPause(): void {
    this.audioElement.pause();
  }

  /**
   * 跳转到指定时间
   * @param time 目标时间（秒）
   */
  public async seek(time: number): Promise<void> {
    this.isInternalSeeking = true;
    this.targetSeekTime = time;

    this.cancelPendingPause();
    this.doSeek(time);
  }

  /**
   * 停止播放并清理当前音频源
   * 彻底移除 src，防止旧链接后续继续触发 canplay 等事件
   */
  public stop(): void {
    super.stop();
    this.audioElement.removeAttribute("src");
    this.audioElement.load();
  }

  /**
   * 执行底层 Seek
   * @param time 目标时间（秒）
   */
  protected doSeek(time: number): void {
    if (Number.isFinite(time)) {
      this.audioElement.currentTime = time;
    }
  }

  /**
   * 设置播放速率
   * @param value 速率值 (0.5 - 2.0)
   */
  public setRate(value: number): void {
    this.audioElement.playbackRate = value;
    this.audioElement.defaultPlaybackRate = value;
  }

  /**
   * 设置音高偏移
   * @param semitones 半音偏移量
   */
  public setPitchShift(semitones: number): void {
    // HTML5 Audio preservesPitch property
    // true (default) = time stretch (pitch constant, speed changes)
    // false = pitch shift (pitch changes with speed)

    // We want to change pitch without changing speed?
    // No, standard Web Audio doesn't support independent pitch shift natively without libraries like SoundTouch.
    // However, if we want to change pitch to match keys:
    // If we use playbackRate to change pitch, speed also changes.
    // If preservesPitch = false, playbackRate changes both pitch and speed (like a vinyl record).

    // If the request is to SHIFT pitch while keeping speed constant: NOT SUPPORTED by HTML5 Audio directly.
    // But if the request is "we have set playbackRate to sync BPM, now we want to correct Pitch":
    // That's complex.

    // For now, let's assume 'preservesPitch' control.
    // If semitones != 0, we might want to disable pitch preservation if we are using rate to shift pitch?
    // Actually, 'preservesPitch' only affects what happens when playbackRate != 1.

    // If we want independent pitch shifting, we can't do it with just AudioElement.
    // But we can implement the interface method to avoid crashes.

    if ("preservesPitch" in this.audioElement) {
      const el = this.audioElement as HTMLAudioElement & { preservesPitch: boolean };
      el.preservesPitch = semitones === 0;
    }
  }

  /**
   * 获取当前播放速率
   * @returns 当前速率值
   */
  public getRate(): number {
    return this.audioElement.playbackRate;
  }

  /**
   * 设置音频输出设备
   * @param deviceId 设备 ID
   */
  protected async doSetSinkId(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    if (typeof this.audioElement.setSinkId === "function") {
      await this.audioElement.setSinkId(deviceId);
    }
  }

  /** 设置音频输出设备 */
  public override async setSinkId(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    if (this.audioElement !== this.graphAudioElement) {
      if (typeof this.audioElement.setSinkId === "function") {
        await this.audioElement.setSinkId(deviceId);
      }
      return;
    }
    await super.setSinkId(deviceId);
  }

  /** 设置音量 */
  public override setVolume(value: number): void {
    super.setVolume(value);
    this.syncDirectVolume();
  }

  /** 设置 ReplayGain */
  public override setReplayGain(gain: number): void {
    super.setReplayGain(gain);
    this.syncDirectVolume();
  }

  /** 设置目标音量 */
  public override rampVolumeTo(value: number, duration: number, curve?: FadeCurve): void {
    super.rampVolumeTo(value, duration, curve);
    this.syncDirectVolume();
  }

  /** 获取当前音频源地址 */
  public get src(): string {
    return this.audioElement.src || "";
  }

  /** 获取音频总时长（秒） */
  public get duration(): number {
    return this.audioElement.duration || 0;
  }

  /**
   * 获取当前播放时间（秒）
   * 如果正在 Seek，返回目标时间以避免进度跳回
   */
  public get currentTime(): number {
    if (this.isInternalSeeking) {
      return this.targetSeekTime;
    }
    const settingStore = useSettingStore();

    const isPlayback = settingStore.audioLatencyHint === "playback";

    let autoLatency = 0;

    if (isPlayback && this.audioCtx && this.audioElement === this.graphAudioElement) {
      autoLatency = (this.audioCtx.outputLatency || 0) + (this.audioCtx.baseLatency || 0);
    }
    const manualCompensation = isPlayback ? this.audioDelayCompensation / 1000 : 0;
    // 基础时间 - 自动延迟补偿 + 手动延迟补偿
    return (this.audioElement.currentTime || 0) - autoLatency + manualCompensation;
  }

  /** 获取是否暂停状态 */
  public get paused(): boolean {
    return this.audioElement.paused;
  }

  /**
   * 获取错误码
   * @returns 错误码 (0: 无错误, 1: ABORTED, 2: NETWORK, 3: DECODE, 4: SRC_NOT_SUPPORTED)
   */
  public getErrorCode(): number {
    if (!this.audioElement.error) return 0;
    switch (this.audioElement.error.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return AudioErrorCode.ABORTED;
      case MediaError.MEDIA_ERR_NETWORK:
        return AudioErrorCode.NETWORK;
      case MediaError.MEDIA_ERR_DECODE:
        return AudioErrorCode.DECODE;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return AudioErrorCode.SRC_NOT_SUPPORTED;
      default:
        return 0;
    }
  }

  /**
   * 监听原生 DOM 事件并转发为标准事件
   * 将 HTMLAudioElement 的事件转换为 BaseAudioPlayer 的统一事件格式
   */
  private bindInternalEvents(element: HTMLAudioElement) {
    element.addEventListener("seeked", () => {
      if (element === this.audioElement) this.isInternalSeeking = false;
    });

    const events: AudioEventType[] = Object.values(AUDIO_EVENTS);

    events.forEach((eventType) => {
      element.addEventListener(eventType, (e) => {
        if (element !== this.audioElement) return;
        if (eventType === AUDIO_EVENTS.ERROR) {
          if (this.shouldUseDirectPlayback()) return;
          this.dispatch(AUDIO_EVENTS.ERROR, {
            originalEvent: e,
            errorCode: this.getErrorCode(),
          });
        } else {
          this.dispatch(eventType);
        }
      });
    });
  }

  /** 判断是否可绕过跨域限制直连播放 */
  private shouldUseDirectPlayback(error?: unknown): boolean {
    if (this.audioElement !== this.graphAudioElement) return false;
    const url = this.graphAudioElement.currentSrc || this.graphAudioElement.src;
    if (!/^https?:\/\//i.test(url)) return false;

    try {
      if (new URL(url).origin === window.location.origin) return false;
    } catch {
      return false;
    }

    return (
      this.graphAudioElement.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
      (error instanceof DOMException && error.name === "NotSupportedError")
    );
  }

  /** 使用不接入 Web Audio 图谱的元素播放无 CORS 音源 */
  private async switchToDirectPlayback(): Promise<void> {
    const source = this.graphAudioElement.currentSrc || this.graphAudioElement.src;
    const seekTime = this.isInternalSeeking
      ? this.targetSeekTime
      : this.graphAudioElement.currentTime || 0;
    const directAudioElement = new Audio();

    directAudioElement.playbackRate = this.graphAudioElement.playbackRate;
    directAudioElement.defaultPlaybackRate = this.graphAudioElement.defaultPlaybackRate;
    directAudioElement.volume = Math.min(1, this.volume * this.replayGain);
    this.bindInternalEvents(directAudioElement);
    this.audioElement = directAudioElement;

    this.graphAudioElement.pause();
    this.graphAudioElement.removeAttribute("src");
    this.graphAudioElement.load();

    directAudioElement.src = source;
    if (seekTime > 0) {
      directAudioElement.addEventListener(
        "loadedmetadata",
        () => {
          directAudioElement.currentTime = seekTime;
        },
        { once: true },
      );
    }
    if (this.sinkId !== "default" && typeof directAudioElement.setSinkId === "function") {
      await directAudioElement.setSinkId(this.sinkId);
    }

    console.warn("[AudioElementPlayer] 音源不支持 CORS，已回退到原生直连播放");
    await directAudioElement.play();
  }

  /** 合并并发的直连回退请求 */
  private startDirectPlayback(): Promise<void> {
    if (!this.directPlaybackPromise) {
      this.directPlaybackPromise = this.switchToDirectPlayback().finally(() => {
        this.directPlaybackPromise = null;
      });
    }
    return this.directPlaybackPromise;
  }

  /** 同步绕过 Web Audio 图谱时的音量 */
  private syncDirectVolume(): void {
    if (this.audioElement === this.graphAudioElement) return;
    this.audioElement.volume = Math.min(1, this.volume * this.replayGain);
  }
}
