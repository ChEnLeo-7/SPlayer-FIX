import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type {
  AndroidDownloadDirectory,
  AndroidDownloadPermissionState,
  AndroidDownloadRequest,
  AndroidDownloadRetryRequest,
  AndroidDownloadTask,
  AndroidDuplicatePolicy,
} from "@/types/android-download";

interface SPlayerDownloadPlugin {
  enqueue(options: AndroidDownloadRequest): Promise<{ task: AndroidDownloadTask }>;
  list(): Promise<{ tasks: AndroidDownloadTask[] }>;
  cancel(options: { taskId: string }): Promise<void>;
  retry(options: AndroidDownloadRetryRequest): Promise<void>;
  resolveConflict(options: {
    taskId: string;
    policy: Exclude<AndroidDuplicatePolicy, "ask">;
  }): Promise<void>;
  checkPermissions(): Promise<AndroidDownloadPermissionState>;
  requestPermissions(): Promise<AndroidDownloadPermissionState>;
  getDownloadDirectory(): Promise<AndroidDownloadDirectory>;
  chooseDownloadDirectory(): Promise<AndroidDownloadDirectory>;
  resetDownloadDirectory(): Promise<AndroidDownloadDirectory>;
  addListener(
    eventName: "taskChanged",
    listener: (task: AndroidDownloadTask) => void,
  ): Promise<PluginListenerHandle>;
}

export const sPlayerDownloadPlugin = registerPlugin<SPlayerDownloadPlugin>("SPlayerDownload");

export const ANDROID_DEFAULT_DOWNLOAD_DIRECTORY = "内部存储/Download/SPlayer";
