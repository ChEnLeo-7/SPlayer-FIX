import { registerPlugin } from "@capacitor/core";

export interface AndroidServerProbeResult {
  url: string;
  resolvedUrl: string;
  mobileApiVersion: number;
}

interface SPlayerServerPlugin {
  getServer(): Promise<{ url: string | null }>;
  testServer(options: { url: string }): Promise<AndroidServerProbeResult>;
  connect(options: { url: string; pluginHeaders: unknown[] }): Promise<AndroidServerProbeResult>;
  clearServer(): Promise<void>;
}

const nativeServerPlugin = registerPlugin<SPlayerServerPlugin>("SPlayerServer");

const getPluginHeaders = (): unknown[] => {
  const capacitor = (
    globalThis as typeof globalThis & { Capacitor?: { PluginHeaders?: unknown[] } }
  ).Capacitor;
  return capacitor?.PluginHeaders ?? [];
};

export const sPlayerServerPlugin = {
  getServer: () => nativeServerPlugin.getServer(),
  testServer: (options: { url: string }) => nativeServerPlugin.testServer(options),
  connect: (options: { url: string }) =>
    nativeServerPlugin.connect({ ...options, pluginHeaders: getPluginHeaders() }),
  clearServer: () => nativeServerPlugin.clearServer(),
};

/** 当前页面是否为 APK 内置启动页 */
export const isAndroidBootstrap =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_URL: "服务器地址格式无效",
  TLS_ERROR: "TLS 证书验证失败",
  TIMEOUT: "连接服务器超时",
  DNS_ERROR: "无法解析服务器地址",
  NETWORK_ERROR: "无法连接服务器，请检查地址和网络",
  HTTP_ERROR: "服务器健康检查失败",
  NOT_SPLAYER: "目标地址不是兼容的 SPlayer 服务",
  INCOMPATIBLE_VERSION: "服务端版本与当前 App 不兼容",
  TOO_MANY_REDIRECTS: "服务器重定向次数过多",
  INVALID_REDIRECT: "服务器返回了无效重定向",
  INSECURE_REDIRECT: "HTTPS 服务不能重定向到 HTTP",
  WEBVIEW_UNSUPPORTED: "Android System WebView 版本过低",
  BRIDGE_ERROR: "Capacitor 原生桥初始化失败",
};

export const getServerConnectionError = (error: unknown): string => {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown };
    if (typeof record.code === "string" && ERROR_MESSAGES[record.code]) {
      return typeof record.message === "string" && record.message
        ? record.message
        : ERROR_MESSAGES[record.code];
    }
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return "连接服务器失败";
};
