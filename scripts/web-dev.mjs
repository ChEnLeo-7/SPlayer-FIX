import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const children = new Set();

const start = (command, args, env = {}, useShell = false) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: useShell,
  });
  children.add(child);
  child.once("exit", (code) => {
    children.delete(child);
    if (code && process.exitCode == null) process.exitCode = code;
  });
  return child;
};

// 纯 Web 模式只启动 Node 服务和 Vite，不启动 Electron。
start(process.execPath, ["account/index.mjs"], { SPLAYER_ALLOW_INSECURE_HTTP: "true" });
start(process.execPath, ["node_modules/@neteasecloudmusicapienhanced/api/app.js"], {
  HOST: "127.0.0.1",
  PORT: process.env.SPLAYER_NETEASE_PORT || "3001",
});
const web = start(
  isWindows ? "pnpm.cmd" : "pnpm",
  ["exec", "vite", "--config", "vite.web.config.ts"],
  {},
  isWindows,
);

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
web.once("exit", () => {
  stop();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
});
