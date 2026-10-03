import { buildAccountApp } from "./app.mjs";

process.umask(0o077);

const host = process.env.SPLAYER_ACCOUNT_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.SPLAYER_ACCOUNT_PORT ?? "25886", 10);
const app = await buildAccountApp({ logger: true });

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
