import type { SongType, SongLevelType } from "@/types/main";
import { useDataStore, useSettingStore } from "@/stores";
import { isElectron, isNativeAndroid } from "@/utils/env";
import { saveAs } from "file-saver";
import { cloneDeep } from "lodash-es";
import { matchSongUrl, songDownloadUrl, songLyric, songUrl, songLyricTTML } from "@/api/song";
import { qqMusicMatch } from "@/api/qqmusic";
import { songLevelData } from "@/utils/meta";
import { getPlayerInfoObj } from "@/utils/format";
import { LyricProcessor, type LyricProcessorOptions, type LyricResult } from "./LyricProcessor";
import { albumDetail } from "@/api/album";
import { isLogin } from "@/utils/auth";
import { createFileNameTemplateValues, renderFileNameTemplate } from "@/utils/fileNameTemplate";
import { sPlayerDownloadPlugin } from "@/platform/android/downloadPlugin";
import type { AndroidDownloadRequest, AndroidDownloadTask } from "@/types/android-download";

const albumArtistCache = new Map<number, string[] | Promise<string[]>>();
const MAX_ALBUM_ARTIST_CACHE_SIZE = 100;

const getAndroidDownloadFormat = (
  fileType: string,
): Pick<AndroidDownloadRequest, "extension" | "mimeType"> => {
  const normalized = fileType.toLowerCase();
  if (normalized === "mp3") return { extension: "mp3", mimeType: "audio/mpeg" };
  if (normalized === "flac") return { extension: "flac", mimeType: "audio/flac" };
  throw new Error(`Android 暂不支持下载 ${normalized.toUpperCase()} 格式`);
};

interface DownloadConfig {
  fileName: string;
  fileType: string;
  path: string;
  downloadMeta: boolean;
  downloadCover: boolean;
  downloadLyric: boolean;
  saveMetaFile: boolean;
  songData: SongType;
  lyric: string;
  albumArtists: string[];
  skipIfExist: boolean;
  threadCount: number;
  referer?: string;
  enableDownloadHttp2: boolean;
}

interface DownloadStrategy {
  readonly id: number;
  readonly name: string;
  readonly song: SongType;
  readonly downloadUrl: string;

  // 准备阶段：获取链接，获取歌词，处理元数据
  prepare(): Promise<void>;

  // 执行阶段：返回给 Electron 下载器需要的配置对象
  getDownloadConfig(): DownloadConfig;

  // 获取播放地址作为网页端下载回退
  getPlaybackDownload(): Promise<{ url: string; type: string }>;

  // 收尾阶段：处理 ASS 生成，歌词文件写入
  postProcess(downloadedFilePath: string): Promise<void>;
}

/**
 * 歌曲下载策略
 */
class SongDownloadStrategy implements DownloadStrategy {
  private settingStore = useSettingStore();
  private dataStore = useDataStore();

  // prepare 阶段准备的状态
  private _downloadUrl = "";
  private fileType = "mp3";
  private lyricResult: LyricResult | null = null;
  private basicLyric = "";
  private ttmlLyric = "";
  private yrcLyric = "";
  private albumArtists: string[] = [];
  private actualQuality = "";
  private releaseDate?: number;
  private frozenFileName = "";

  constructor(
    public readonly song: SongType,
    private quality: SongLevelType,
  ) {}

  get id() {
    return this.song.id;
  }
  get name() {
    return this.song.name;
  }
  get downloadUrl() {
    return this._downloadUrl;
  }

  async prepare(): Promise<void> {
    // 解析下载链接
    const { url, type, level } = await this.resolveUrl();
    this._downloadUrl = url;
    this.fileType = type;
    this.actualQuality = this.getQualityName(level);

    // 获取歌词
    if (this.shouldDownloadLyrics()) {
      this.lyricResult = (await songLyric(this.song.id)) as LyricResult;

      const options: LyricProcessorOptions = {
        downloadLyricToTraditional: this.settingStore.downloadLyricToTraditional,
        downloadLyricTranslation: this.settingStore.downloadLyricTranslation,
        downloadLyricRomaji: this.settingStore.downloadLyricRomaji,
        downloadLyricEncoding: this.settingStore.downloadLyricEncoding,
      };

      // 处理基础歌词
      this.basicLyric = await LyricProcessor.processBasic(this.lyricResult, options);

      // 处理逐字歌词 (后续使用)
      const { downloadMakeYrc, downloadSaveAsAss } = this.settingStore;
      if (downloadMakeYrc || downloadSaveAsAss) {
        let ttmlLyric = "";
        const yrcLyric = this.lyricResult?.yrc?.lyric || "";
        let qmResultData;

        try {
          const ttmlRes = await songLyricTTML(this.song.id);
          if (typeof ttmlRes === "string") ttmlLyric = ttmlRes;
        } catch (e) {
          console.error("Failed to fetch TTML", e);
        }

        if (!ttmlLyric && !yrcLyric) {
          try {
            const artistsStr = Array.isArray(this.song.artists)
              ? this.song.artists.map((a) => a.name).join("/")
              : String(this.song.artists || "");
            const keyword = `${this.song.name}-${artistsStr}`;
            const qmResult = await qqMusicMatch(keyword);
            if (qmResult?.code === 200 && qmResult?.qrc) {
              qmResultData = qmResult;
            }
          } catch (e) {
            console.error("QM Fallback failed", e);
          }
        }

        const verbatim = LyricProcessor.parseVerbatim(ttmlLyric, yrcLyric, qmResultData);
        this.ttmlLyric = verbatim.ttml;
        this.yrcLyric = verbatim.yrc;
      }
    }

    // 处理专辑艺术家信息
    const album = this.song.album;
    if (typeof album !== "string") {
      const needsAlbumDetail =
        this.settingStore.downloadMeta ||
        this.settingStore.fileNameTemplate.includes("{releaseDate}");
      if (needsAlbumDetail) {
        const cached = albumArtistCache.get(album.id);
        if (cached instanceof Array) {
          this.albumArtists = cached;
        } else if (cached instanceof Promise) {
          this.albumArtists = await cached;
        } else {
          const promise = albumDetail(album.id)
            .then((res) => {
              if (res.code === 200) {
                this.releaseDate = res.album?.publishTime;
                const artistName = res?.album?.artists?.map((a) => a.name) || [];
                albumArtistCache.set(album.id, artistName);
                // 控制缓存大小
                if (albumArtistCache.size > MAX_ALBUM_ARTIST_CACHE_SIZE) {
                  for (const [k, v] of albumArtistCache) {
                    if (v instanceof Array) {
                      albumArtistCache.delete(k);
                      if (albumArtistCache.size < MAX_ALBUM_ARTIST_CACHE_SIZE) break;
                    }
                  }
                }
                return artistName;
              }
              return [];
            })
            .catch((e) => {
              console.error(`获取专辑艺术家失败: ${album.id}`, e);
              return [];
            });
          albumArtistCache.set(album.id, promise);
          this.albumArtists = await promise;
        }
        if (!this.releaseDate && this.settingStore.fileNameTemplate.includes("{releaseDate}")) {
          const detail = await albumDetail(album.id).catch(() => null);
          this.releaseDate = detail?.album?.publishTime;
        }
      }
    }
    this.releaseDate ??= this.song.releaseDate;
    this.song.releaseDate = this.releaseDate;
    this.frozenFileName = renderFileNameTemplate(
      this.settingStore.fileNameTemplate,
      createFileNameTemplateValues(this.song, {
        quality: this.actualQuality,
        releaseDate: this.releaseDate,
      }),
    );
  }
  /**
   * 获取下载配置
   * @returns 下载配置
   */
  getDownloadConfig(): DownloadConfig {
    const fileName = this.getFileName();
    const targetPath = this.getDownloadPath();
    const { downloadMeta, downloadCover, saveMetaFile, downloadThreadCount, enableDownloadHttp2 } =
      this.settingStore;

    return {
      fileName,
      fileType: this.fileType,
      path: targetPath,
      downloadMeta: downloadMeta,
      downloadCover: downloadCover && downloadMeta,
      downloadLyric: this.shouldDownloadLyrics(),
      saveMetaFile: downloadMeta && saveMetaFile,
      songData: cloneDeep(this.song),
      lyric: this.basicLyric,
      albumArtists: this.albumArtists,
      skipIfExist: true,
      threadCount: downloadThreadCount,
      enableDownloadHttp2: enableDownloadHttp2,
    };
  }

  async getPlaybackDownload(): Promise<{ url: string; type: string }> {
    const levelName = songLevelData[this.quality].level;
    const result = await songUrl(this.song.id, levelName as Parameters<typeof songUrl>[1]);
    const data = Array.isArray(result.data) ? result.data[0] : result.data?.[0];
    if (result.code !== 200 || !data?.url) {
      throw new Error("获取播放音源失败");
    }
    return {
      url: data.url,
      type: (data.type || data.encodeType || "mp3").toLowerCase(),
    };
  }
  /**
   * 后置处理
   * @param downloadedFilePath 下载文件路径
   */
  async postProcess(downloadedFilePath: string): Promise<void> {
    console.log(`Post-processing file: ${downloadedFilePath}`);
    // 使用存储的文件名和路径
    const fileName = this.getFileName();
    const targetPath = this.getDownloadPath();
    const { downloadMakeYrc, downloadSaveAsAss } = this.settingStore;

    const options: LyricProcessorOptions = {
      downloadLyricToTraditional: this.settingStore.downloadLyricToTraditional,
      downloadLyricTranslation: this.settingStore.downloadLyricTranslation,
      downloadLyricRomaji: this.settingStore.downloadLyricRomaji,
      downloadLyricEncoding: this.settingStore.downloadLyricEncoding,
    };

    if (downloadMakeYrc) {
      const result = await LyricProcessor.generateVerbatimContent(
        this.ttmlLyric,
        this.yrcLyric,
        this.lyricResult,
        options,
      );
      if (result && window.electron?.ipcRenderer) {
        await window.electron.ipcRenderer.invoke("save-file", {
          targetPath,
          fileName,
          ext: result.ext,
          content: result.content,
          encoding: result.encoding,
        });
      }
    }

    if (downloadSaveAsAss) {
      const artist = Array.isArray(this.song.artists)
        ? this.song.artists[0]?.name
        : String(this.song.artists || "");
      const result = await LyricProcessor.generateAssContent(
        this.ttmlLyric,
        this.yrcLyric,
        this.lyricResult,
        this.song.name,
        artist,
        options,
      );

      if (result && window.electron?.ipcRenderer) {
        await window.electron.ipcRenderer.invoke("save-file", {
          targetPath,
          fileName,
          ext: "ass",
          content: result.content,
          encoding: result.encoding,
        });
      }
    }
  }

  private async resolveUrl(): Promise<{ url: string; type: string; level?: string }> {
    const usePlayback = this.settingStore.usePlaybackForDownload;
    const levelName = songLevelData[this.quality].level;

    // 尝试使用播放链接
    if (usePlayback || !isLogin()) {
      try {
        const result = await songUrl(this.song.id, levelName as Parameters<typeof songUrl>[1]);
        if (result.code === 200 && result?.data?.[0]?.url) {
          return {
            url: result.data[0].url,
            type: (result.data[0].type || result.data[0].encodeType || "mp3").toLowerCase(),
            level: result.data[0].level,
          };
        }
      } catch (e) {
        console.error("Error fetching playback url for download:", e);
      }
    }

    // 尝试使用解锁链接
    const isVipUser = this.dataStore.userData?.vipType > 0;
    const isRestricted = this.song.free === 1 || this.song.free === 4 || this.song.free === 8;
    const canUseUnlock = !isRestricted || isVipUser;

    const useUnlock =
      this.settingStore.useUnlockForDownload ||
      (isNativeAndroid && this.settingStore.useSongUnlock);
    if (useUnlock && canUseUnlock) {
      try {
        const matchResult = await matchSongUrl(this.song.id, "unm");
        const matchUrl =
          matchResult?.url ||
          (typeof matchResult?.data === "string" ? matchResult.data : undefined) ||
          matchResult?.data?.url ||
          matchResult?.data?.[0]?.url ||
          matchResult?.proxyUrl;
        if (/^https?:\/\//i.test(matchUrl || "")) {
          return { url: matchUrl, type: this.getUrlType(matchUrl), level: levelName };
        }
      } catch (e) {
        console.error("Error fetching unlock url for download:", e);
      }
    }

    // 标准下载流程
    const result = await songDownloadUrl(this.song.id, this.quality);
    if (result.code !== 200 || !result?.data?.url) {
      throw new Error(result.message || "获取下载链接失败");
    }
    return {
      url: result.data.url,
      type: result.data.type?.toLowerCase() || "mp3",
      level: result.data.level,
    };
  }

  private getQualityName(level?: string): string {
    const quality = Object.values(songLevelData).find((item) => item.level === level);
    return quality?.shortName || songLevelData[this.quality].shortName;
  }

  private getUrlType(url: string, fallback = "mp3"): string {
    const extension = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1];
    return (extension || fallback).toLowerCase();
  }
  /**
   * 获取文件名
   * @returns 文件名
   */
  private getFileName(): string {
    return this.frozenFileName || this.song.name || "未知歌曲";
  }
  /**
   * 获取下载路径
   * @returns 下载路径
   */
  private getDownloadPath(): string {
    const finalPath = this.settingStore.downloadPath;
    const infoObj = getPlayerInfoObj(this.song) || { artist: "未知歌手", album: "未知专辑" };
    const safeArtist = (infoObj.artist || "未知歌手").replace(/[/:*?"<>|]/g, "&");
    const safeAlbum = (infoObj.album || "未知专辑").replace(/[/:*?"<>|]/g, "&");
    const { folderStrategy } = this.settingStore;

    if (folderStrategy === "artist") return `${finalPath}/${safeArtist}`;
    else if (folderStrategy === "artist-album") return `${finalPath}/${safeArtist}/${safeAlbum}`;
    return finalPath;
  }

  private shouldDownloadLyrics(): boolean {
    return this.settingStore.downloadLyric && this.settingStore.downloadMeta;
  }
}

// 下载管理器核心类

class DownloadManager {
  private queue: DownloadStrategy[] = [];
  private activeDownloads: Set<number> = new Set();
  private maxConcurrent: number = 1;
  private initialized: boolean = false;
  private androidTaskBySong = new Map<number, string>();
  private androidPending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();

  constructor() {
    this.setupIpcListeners();
  }

  public init() {
    if (this.initialized) return;
    this.initialized = true;
    if (isNativeAndroid) {
      void this.setupAndroidDownloads();
      return;
    }
    if (!isElectron) return;

    const dataStore = useDataStore();

    // 清理卡住的任务状态
    dataStore.downloadingSongs.forEach((item) => {
      if (item.status === "downloading") {
        dataStore.updateDownloadStatus(item.song.id, "waiting");
        dataStore.updateDownloadProgress(item.song.id, 0, "0MB", "0MB");
      }
    });

    // 重新加入等待中的任务
    dataStore.downloadingSongs.forEach((item) => {
      if (item.status === "waiting") {
        const isQueued = this.queue.some((s) => s.id === item.song.id);
        const isActive = this.activeDownloads.has(item.song.id);
        if (!isQueued && !isActive) {
          // 常规歌曲下载
          this.queue.push(new SongDownloadStrategy(item.song as SongType, item.quality));
        }
      }
    });

    this.processQueue();
  }

  private async setupAndroidDownloads() {
    const settingStore = useSettingStore();
    try {
      const directory = await sPlayerDownloadPlugin.getDownloadDirectory();
      settingStore.downloadPath = directory.displayName;
    } catch (error) {
      console.error("读取 Android 下载目录失败:", error);
    }
    await sPlayerDownloadPlugin.addListener("taskChanged", (task) => {
      this.handleAndroidTask(task);
    });
    const permissions = await sPlayerDownloadPlugin.checkPermissions();
    if (permissions.notifications === "prompt" || permissions.storage === "prompt") {
      await sPlayerDownloadPlugin.requestPermissions();
    }
    const dataStore = useDataStore();
    const { tasks } = await sPlayerDownloadPlugin.list();
    const nativeSongs = new Set<number>();
    for (const task of tasks) {
      const songId = Number(task.clientKey);
      if (!Number.isFinite(songId)) continue;
      nativeSongs.add(songId);
      this.androidTaskBySong.set(songId, task.taskId);
      this.handleAndroidTask(task);
    }
    dataStore.downloadingSongs.forEach((item) => {
      if (nativeSongs.has(item.song.id)) return;
      if (item.status === "downloading") dataStore.updateDownloadStatus(item.song.id, "waiting");
      if (item.status === "waiting") {
        this.queue.push(new SongDownloadStrategy(item.song as SongType, item.quality));
      }
    });
    this.processQueue();
  }

  private handleAndroidTask(task: AndroidDownloadTask) {
    const songId = Number(task.clientKey);
    if (!Number.isFinite(songId)) return;
    const dataStore = useDataStore();
    this.androidTaskBySong.set(songId, task.taskId);
    if (task.status === "queued") dataStore.updateDownloadStatus(songId, "waiting");
    if (task.status === "downloading") {
      dataStore.updateDownloadStatus(songId, "downloading");
      dataStore.updateDownloadProgress(
        songId,
        Number(task.progress.toFixed(1)),
        this.formatBytes(task.transferredBytes),
        this.formatBytes(task.totalBytes),
      );
    }
    if (task.status === "completed") {
      dataStore.removeDownloadingSong(songId);
      this.androidTaskBySong.delete(songId);
      this.androidPending.get(task.taskId)?.resolve();
      this.androidPending.delete(task.taskId);
      window.$message.success("歌曲已保存到 Download/SPlayer");
    }
    if (task.status === "failed") {
      dataStore.markDownloadFailed(songId);
      this.androidPending.get(task.taskId)?.reject(new Error(task.message || "下载失败"));
      this.androidPending.delete(task.taskId);
    }
    if (task.status === "cancelled") {
      this.androidTaskBySong.delete(songId);
      this.androidPending.get(task.taskId)?.reject(new Error("下载已取消"));
      this.androidPending.delete(task.taskId);
    }
    if (task.status === "conflict") this.showAndroidConflict(task);
  }

  private showAndroidConflict(task: AndroidDownloadTask) {
    window.$dialog.warning({
      title: "文件已存在",
      content: `${task.fileName}.${task.extension} 已存在，请选择处理方式。`,
      positiveText: "覆盖",
      negativeText: "保留副本",
      closable: true,
      maskClosable: false,
      onPositiveClick: () =>
        sPlayerDownloadPlugin.resolveConflict({ taskId: task.taskId, policy: "replace" }),
      onNegativeClick: () =>
        sPlayerDownloadPlugin.resolveConflict({ taskId: task.taskId, policy: "rename" }),
      onClose: () => sPlayerDownloadPlugin.cancel({ taskId: task.taskId }),
    });
  }

  private formatBytes(value: number): string {
    if (!value) return "0MB";
    return `${(value / 1024 / 1024).toFixed(2)}MB`;
  }
  /**
   * 设置 IPC 监听器
   */
  private setupIpcListeners() {
    if (typeof window === "undefined" || !window.electron?.ipcRenderer) return;
    window.electron.ipcRenderer.on("download-progress", (_event, progress) => {
      const { id, percent, transferredBytes, totalBytes } = progress;
      if (!id) return;
      const dataStore = useDataStore();
      const transferred = transferredBytes
        ? (transferredBytes / 1024 / 1024).toFixed(2) + "MB"
        : "0MB";
      const total = totalBytes ? (totalBytes / 1024 / 1024).toFixed(2) + "MB" : "0MB";
      dataStore.updateDownloadProgress(id, Number((percent * 100).toFixed(1)), transferred, total);
    });
  }
  /**
   * 获取已下载的歌曲
   * @returns 已下载的歌曲列表
   */
  public async getDownloadedSongs(): Promise<Record<string, unknown>[]> {
    const settingStore = useSettingStore();
    if (!isElectron) return [];
    const downloadPath = settingStore.downloadPath;
    if (!downloadPath) return [];
    try {
      return await window.electron.ipcRenderer.invoke("get-downloaded-songs", downloadPath);
    } catch (error) {
      console.error("Failed to get downloaded songs:", error);
      return [];
    }
  }
  /**
   * 添加下载任务
   * @param song 歌曲信息
   * @param quality 歌曲质量
   */
  public async addDownload(song: SongType, quality: SongLevelType) {
    this.init();
    const dataStore = useDataStore();
    if (this.checkExisting(song.id)) return;
    dataStore.addDownloadingSong(song, quality);
    const strategy = new SongDownloadStrategy(song, quality);
    this.queue.push(strategy);
    this.processQueue();
  }
  /**
   * 移除下载任务
   * @param id 歌曲ID
   */
  public removeDownload(id: number) {
    const dataStore = useDataStore();
    // 如果正在下载，尝试取消（目前仅移除任务）
    if (this.activeDownloads.has(id)) {
      // TODO: 实现取消正在进行的下载任务
      // 暂时先从活动集合中移除，以释放下载槽位
      this.activeDownloads.delete(id);
    }
    // 从队列中移除
    this.queue = this.queue.filter((task) => task.id !== id);
    if (isNativeAndroid) {
      const taskId = this.androidTaskBySong.get(id);
      if (taskId) void sPlayerDownloadPlugin.cancel({ taskId });
      this.androidTaskBySong.delete(id);
    }
    // 从 store 移除
    dataStore.removeDownloadingSong(id);
    // 尝试处理下一个任务
    this.processQueue();
  }
  /**
   * 重新下载任务
   * @param id 歌曲ID
   */
  public retryDownload(id: number) {
    const dataStore = useDataStore();
    const task = dataStore.downloadingSongs.find((s) => s.song.id === id);
    if (task) {
      dataStore.updateDownloadStatus(id, "waiting");
      if (isNativeAndroid) {
        const taskId = this.androidTaskBySong.get(id);
        if (taskId) {
          const strategy = new SongDownloadStrategy(task.song as SongType, task.quality);
          void strategy
            .prepare()
            .then(() => {
              const format = getAndroidDownloadFormat(strategy.getDownloadConfig().fileType);
              return sPlayerDownloadPlugin.retry({ taskId, url: strategy.downloadUrl, ...format });
            })
            .catch((error) => {
              dataStore.markDownloadFailed(id);
              window.$message.error(error instanceof Error ? error.message : "重试下载失败");
            });
          return;
        }
      }
      // 重新加入队列
      this.queue.push(new SongDownloadStrategy(task.song as SongType, task.quality));
      this.processQueue();
    }
  }
  /**
   * 重新下载所有失败的任务
   */
  public retryAllDownloads() {
    this.init();
    const dataStore = useDataStore();
    const failedSongs = dataStore.downloadingSongs
      .filter((item) => item.status === "failed")
      .map((item) => item.song.id);
    failedSongs.forEach((id) => this.retryDownload(id));
  }
  /**
   * 检查是否存在相同的下载任务
   * @param id 歌曲ID
   * @returns 是否存在相同的下载任务
   */
  private checkExisting(id: number): boolean {
    const dataStore = useDataStore();
    const existing = dataStore.downloadingSongs.find((item) => item.song.id === id);

    if (existing) {
      if (existing.status === "failed") {
        this.retryDownload(id);
        return true;
      }
      const isQueued = this.queue.some((s) => s.id === id);
      const isActive = this.activeDownloads.has(id);
      if (
        isQueued ||
        isActive ||
        existing.status === "waiting" ||
        existing.status === "downloading"
      ) {
        return true;
      }
    }
    return false;
  }
  /**
   * 处理下载队列
   */
  private processQueue() {
    while (this.activeDownloads.size < this.maxConcurrent && this.queue.length > 0) {
      const strategy = this.queue.shift();
      if (strategy) this.startTask(strategy);
    }
  }
  /**
   * 开始下载任务
   * @param strategy 下载策略
   */
  private async startTask(strategy: DownloadStrategy) {
    this.activeDownloads.add(strategy.id);
    const dataStore = useDataStore();
    dataStore.updateDownloadStatus(strategy.id, "downloading");

    try {
      await strategy.prepare();
      const config = strategy.getDownloadConfig();

      if (isNativeAndroid) {
        await this.startAndroidTask(strategy, config);
      } else if (isElectron) {
        if (!strategy.downloadUrl) throw new Error("Download URL missing");

        const downloadResult = await window.electron.ipcRenderer.invoke(
          "download-file",
          strategy.downloadUrl,
          config,
        );

        if (downloadResult.status === "success" || downloadResult.status === "skipped") {
          await strategy.postProcess(downloadResult.path || config.path); // IPC 返回结果通常包含路径
          dataStore.removeDownloadingSong(strategy.id);
          window.$message.success(`${strategy.name} 下载完成`);
        } else {
          if (downloadResult.status === "cancelled") {
            // 已取消，无需处理
          } else {
            throw new Error(downloadResult.message || "下载失败");
          }
        }
      } else {
        // 浏览器端兜底处理
        if (!strategy.downloadUrl) throw new Error("Download URL missing");
        const fileName = config.fileName + "." + config.fileType;
        try {
          if (!/^https?:\/\//.test(strategy.downloadUrl)) {
            saveAs(strategy.downloadUrl, fileName);
            dataStore.removeDownloadingSong(strategy.id);
            return;
          }
          // 仅允许直连音源，避免占用服务端上传带宽
          const response = await fetch(strategy.downloadUrl);
          if (!response.ok) throw new Error("下载失败");
          const blob = await response.blob();
          saveAs(blob, fileName);
        } catch (error) {
          console.warn("下载音源直连失败，尝试使用播放音源:", error);
          const playback = await strategy.getPlaybackDownload();
          const playbackFileName = config.fileName + "." + playback.type;
          try {
            const response = await fetch(playback.url);
            if (!response.ok) throw new Error("播放音源下载失败");
            const blob = await response.blob();
            saveAs(blob, playbackFileName);
          } catch (playbackError) {
            console.warn("播放音源无法读取响应，改用浏览器直接下载:", playbackError);
            saveAs(playback.url, playbackFileName);
          }
        }
        dataStore.removeDownloadingSong(strategy.id);
      }
    } catch (error: any) {
      console.error(`Error processing task ${strategy.name} (ID: ${strategy.id}):`, error);
      if (error?.message) console.error("Error message:", error.message);

      dataStore.markDownloadFailed(strategy.id);
      window.$message.error(error.message || "下载出错");
    } finally {
      this.activeDownloads.delete(strategy.id);
      this.processQueue();
    }
  }

  private async startAndroidTask(strategy: DownloadStrategy, config: DownloadConfig) {
    const taskId = crypto.randomUUID();
    this.androidTaskBySong.set(strategy.id, taskId);
    const artists = Array.isArray(config.songData.artists)
      ? config.songData.artists.map((item) => item.name).join(", ")
      : String(config.songData.artists || "");
    const album =
      typeof config.songData.album === "string"
        ? config.songData.album
        : config.songData.album?.name || "";
    const { extension, mimeType } = getAndroidDownloadFormat(config.fileType);
    const completion = new Promise<void>((resolve, reject) => {
      this.androidPending.set(taskId, { resolve, reject });
    });
    await sPlayerDownloadPlugin.enqueue({
      taskId,
      clientKey: String(strategy.id),
      url: strategy.downloadUrl,
      fileName: config.fileName,
      extension,
      mimeType,
      duplicatePolicy: "ask",
      metadata: config.downloadMeta
        ? {
            title: config.songData.name,
            artist: artists,
            album,
            albumArtist: config.albumArtists.join(", ") || undefined,
            year: config.songData.releaseDate
              ? String(new Date(config.songData.releaseDate).getFullYear())
              : undefined,
            track: config.songData.trackNumber ? String(config.songData.trackNumber) : undefined,
          }
        : undefined,
    });
    await completion;
  }
}

export const downloadManager = new DownloadManager();
export const useDownloadManager = () => downloadManager;
export default downloadManager;
