import type { FastifyInstance, FastifyServerOptions } from "fastify";

export interface AccountAppOptions {
  databasePath?: string;
  sessionMaxAgeSeconds?: number;
  cookieSecure?: boolean;
  allowedHosts?: string[];
  bodyLimit?: number;
  logger?: FastifyServerOptions["logger"];
  trustProxy?: FastifyServerOptions["trustProxy"];
  adminToken?: string;
  allowInsecureHttp?: boolean;
  maxAccounts?: number;
  maxSyncOperations?: number;
  maxSyncBytes?: number;
  maxOperationBytes?: number;
  maxOperationsPerBatch?: number;
  maxPullLimit?: number;
}

export function buildAccountApp(options?: AccountAppOptions): Promise<FastifyInstance>;
