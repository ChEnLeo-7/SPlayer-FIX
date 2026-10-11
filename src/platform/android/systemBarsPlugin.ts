import { registerPlugin } from "@capacitor/core";

interface SystemBarsPlugin {
  setStyle(options: {
    bar?: "StatusBar" | "NavigationBar";
    style: "DARK" | "LIGHT";
  }): Promise<void>;
}

export const systemBarsPlugin = registerPlugin<SystemBarsPlugin>("SystemBars");
