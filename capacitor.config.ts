import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.SPLAYER_ANDROID_SERVER_URL || "http://192.168.2.109:14558";

const config: CapacitorConfig = {
  appId: "io.github.chenleo7.splayerfix",
  appName: "SPlayer",
  webDir: "dist/android",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  },
  android: {
    allowMixedContent: serverUrl.startsWith("http://"),
    backgroundColor: "#101114",
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
