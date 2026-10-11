import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.chenleo7.splayerfix",
  appName: "SPlayer",
  webDir: "dist/android",
  server: {
    cleartext: true,
  },
  android: {
    backgroundColor: "#101114",
    useLegacyBridge: true,
  },
  plugins: {
    SystemBars: {
      insetsHandling: "disable",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
  },
};

export default config;
