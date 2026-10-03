import type { ConfigEnv, Plugin, UserConfig } from "vite";
import electronConfig from "./electron.vite.config";

export default async (env: ConfigEnv): Promise<UserConfig> => {
  const config =
    typeof electronConfig === "function" ? await electronConfig(env as never) : electronConfig;
  const renderer = config.renderer as UserConfig;
  const plugins = (renderer.plugins ?? [])
    .flat(Number.POSITIVE_INFINITY)
    .filter((plugin): plugin is Plugin => Boolean(plugin) && plugin.name !== "vite:compression");

  return {
    ...renderer,
    base: "./",
    plugins,
    build: {
      ...renderer.build,
      outDir: "dist/android",
      emptyOutDir: true,
      rollupOptions: {
        ...renderer.build?.rollupOptions,
        input: "index.html",
      },
    },
  };
};
