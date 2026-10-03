import type { ConfigEnv, UserConfig } from "vite";
import electronConfig from "./electron.vite.config";

export default async (env: ConfigEnv): Promise<UserConfig> => {
  const config =
    typeof electronConfig === "function" ? await electronConfig(env as never) : electronConfig;
  const renderer = config.renderer as UserConfig;

  return {
    ...renderer,
    server: {
      ...renderer.server,
      host: process.env.VITE_WEB_HOST || "127.0.0.1",
      strictPort: true,
      proxy: {
        "/api/splayer": {
          target: "http://127.0.0.1:25886",
          changeOrigin: false,
        },
        "/api/netease": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/netease/, ""),
        },
      },
    },
  };
};
