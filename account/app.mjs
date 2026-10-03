import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";
import { openDatabase } from "./database.mjs";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "splayer_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const REGISTRATION_MAX_ATTEMPTS = 3;
const MAX_STRING_LENGTH = 4 * 1024 * 1024;
const AUTH_KDF_ITERATIONS = 600_000;
const AUTH_DOMAIN = "SPLAYER_AUTH_V1";

class ApiError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!isObject(value)) throw new ApiError(400, "INVALID_REQUEST", `${name} 格式无效`);
  return value;
}

function requireExactKeys(value, name, expectedKeys) {
  const object = requireObject(value, name);
  const keys = Object.keys(object);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new ApiError(400, "INVALID_REQUEST", `${name} 包含未知字段`);
  }
  return object;
}

function requireString(value, name, maximumLength = MAX_STRING_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new ApiError(400, "INVALID_REQUEST", `${name} 格式无效`);
  }
  return value;
}

function normalizeUsername(username) {
  const displayName = requireString(username, "username", 32).normalize("NFKC").trim();
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(displayName)) {
    throw new ApiError(
      400,
      "INVALID_USERNAME",
      "用户名须为 3 至 32 个字母、数字、下划线、点或连字符",
    );
  }
  return { displayName, normalizedUsername: displayName.toLocaleLowerCase("und") };
}

function deriveAuthenticationSecret(username, password) {
  const normalizedUsername = username.normalize("NFKC").trim().toLocaleLowerCase("und");
  const salt = createHash("sha256").update(`${AUTH_DOMAIN}:${normalizedUsername}`).digest();
  return pbkdf2Sync(password, salt, AUTH_KDF_ITERATIONS, 32, "sha256").toString("base64url");
}

function requireAuthSecret(value, name = "authSecret") {
  const secret = requireString(value, name, 128);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(secret)) {
    throw new ApiError(400, "INVALID_CREDENTIALS", "认证信息格式无效");
  }
  return secret;
}

function requireCipher(value, name) {
  const cipher = requireExactKeys(value, name, ["nonce", "ciphertext"]);
  requireString(cipher.nonce, `${name}.nonce`);
  requireString(cipher.ciphertext, `${name}.ciphertext`);
  return value;
}

function requireEncryption(value) {
  const encryption = requireExactKeys(value, "encryption", [
    "kdfSalt",
    "kdfIterations",
    "wrappedVaultKey",
    "recoveryWrappedVaultKey",
  ]);
  requireString(encryption.kdfSalt, "encryption.kdfSalt");
  if (!Number.isSafeInteger(encryption.kdfIterations) || encryption.kdfIterations < 1) {
    throw new ApiError(400, "INVALID_REQUEST", "encryption.kdfIterations 格式无效");
  }
  requireCipher(encryption.wrappedVaultKey, "encryption.wrappedVaultKey");
  requireCipher(encryption.recoveryWrappedVaultKey, "encryption.recoveryWrappedVaultKey");
  return value;
}

function requireVault(value) {
  const vault = requireExactKeys(value, "vault", ["schemaVersion", "nonce", "ciphertext"]);
  if (!Number.isSafeInteger(vault.schemaVersion) || vault.schemaVersion < 1) {
    throw new ApiError(400, "INVALID_REQUEST", "vault.schemaVersion 格式无效");
  }
  requireString(vault.nonce, "vault.nonce");
  requireString(vault.ciphertext, "vault.ciphertext");
  return value;
}

function requirePasswordEncryption(value) {
  const encryption = requireExactKeys(value, "passwordEncryption", [
    "kdfSalt",
    "kdfIterations",
    "wrappedVaultKey",
  ]);
  requireString(encryption.kdfSalt, "passwordEncryption.kdfSalt");
  if (!Number.isSafeInteger(encryption.kdfIterations) || encryption.kdfIterations < 1) {
    throw new ApiError(400, "INVALID_REQUEST", "passwordEncryption.kdfIterations 格式无效");
  }
  requireCipher(encryption.wrappedVaultKey, "passwordEncryption.wrappedVaultKey");
  return value;
}

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt, hash };
}

async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  return hash.length === expectedHash.length && timingSafeEqual(hash, expectedHash);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest();
}

function parseJson(value) {
  return JSON.parse(value);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

function accountResponse(database, user) {
  const encryption = database
    .prepare("SELECT envelope_json FROM encryptions WHERE user_id = ?")
    .get(user.id);
  const vault = database
    .prepare("SELECT vault_json, revision FROM vaults WHERE user_id = ?")
    .get(user.id);

  return {
    user: publicUser(user),
    encryption: parseJson(encryption.envelope_json),
    vault: parseJson(vault.vault_json),
    revision: vault.revision,
  };
}

function isValidHost(host) {
  return typeof host === "string" && /^[a-z0-9.[\]:_-]+$/i.test(host) && host.length <= 255;
}

function baseHost(host) {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0];
}

export async function buildAccountApp(options = {}) {
  const databasePath =
    options.databasePath ??
    process.env.SPLAYER_ACCOUNT_DB ??
    join(process.cwd(), "data", "splayer-account.db");
  const database = openDatabase(databasePath);
  const loginAttempts = new Map();
  const dummyPassword = await hashPassword(randomBytes(32).toString("base64url"));
  const sessionMaxAgeSeconds = options.sessionMaxAgeSeconds ?? SESSION_MAX_AGE_SECONDS;
  const cookieSecure = options.cookieSecure ?? process.env.SPLAYER_COOKIE_SECURE === "true";
  const allowInsecureHttp =
    options.allowInsecureHttp ?? process.env.SPLAYER_ALLOW_INSECURE_HTTP !== "false";
  const maxAccounts = options.maxAccounts ?? Number(process.env.SPLAYER_MAX_ACCOUNTS || 1000);
  const allowedHosts = new Set(
    (options.allowedHosts ?? process.env.SPLAYER_ALLOWED_HOSTS?.split(",") ?? [])
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  const app = Fastify({
    bodyLimit: options.bodyLimit ?? 5 * 1024 * 1024,
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? "127.0.0.1",
  });

  await app.register(fastifyCookie);

  const deleteExpiredSessions = () => {
    database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    const oldestAttempt = Date.now() - REGISTRATION_WINDOW_MS;
    for (const [key, attempts] of loginAttempts) {
      const activeAttempts = attempts.filter((attemptedAt) => attemptedAt > oldestAttempt);
      if (activeAttempts.length) loginAttempts.set(key, activeAttempts);
      else loginAttempts.delete(key);
    }
  };
  const cleanupTimer = setInterval(deleteExpiredSessions, 15 * 60 * 1000);
  cleanupTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    database.close();
  });

  app.addHook("onRequest", async (request) => {
    const host = request.headers.host?.toLowerCase();
    if (!isValidHost(host)) throw new ApiError(400, "INVALID_HOST", "Host 请求头无效");
    if (allowedHosts.size > 0 && !allowedHosts.has(host) && !allowedHosts.has(baseHost(host))) {
      throw new ApiError(403, "HOST_NOT_ALLOWED", "Host 不在允许列表中");
    }

    const origin = request.headers.origin;
    if (origin) {
      let originUrl;
      try {
        originUrl = new URL(origin);
      } catch {
        throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Origin 无效");
      }
      if (
        !["http:", "https:"].includes(originUrl.protocol) ||
        originUrl.host.toLowerCase() !== host
      ) {
        throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Origin 与 Host 不匹配");
      }
    }

    const forwardedProtocol = request.headers["x-forwarded-proto"]?.split(",", 1)[0]?.trim();
    const protocol = forwardedProtocol || request.protocol;
    const hostname = baseHost(host);
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
    const credentialPath = request.url.split("?", 1)[0];
    const carriesCredentials =
      request.method === "POST" &&
      [
        "/api/splayer/register",
        "/api/splayer/login",
        "/api/splayer/password",
        "/api/splayer/admin/reset-password",
      ].includes(credentialPath);
    if (carriesCredentials && !allowInsecureHttp && !isLoopback && protocol !== "https") {
      throw new ApiError(426, "HTTPS_REQUIRED", "账户认证必须通过 HTTPS 连接");
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
        ...error.details,
      });
    }
    if (error.statusCode === 413) {
      return reply.code(413).send({
        error: { code: "BODY_TOO_LARGE", message: "请求体超过大小限制" },
      });
    }
    if (error.validation) {
      return reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: "请求格式无效" },
      });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: { code: "INVALID_REQUEST", message: "请求格式无效" },
      });
    }
    app.log.error({ err: error }, "账户服务请求失败");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: "接口不存在" },
    });
  });

  function setSessionCookie(request, reply, token) {
    const forwardedProtocol = request.headers["x-forwarded-proto"]?.split(",", 1)[0]?.trim();
    const secure = cookieSecure || request.protocol === "https" || forwardedProtocol === "https";
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/api/splayer",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: sessionMaxAgeSeconds,
    });
  }

  function clearSessionCookie(reply) {
    reply.clearCookie(SESSION_COOKIE, {
      path: "/api/splayer",
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure,
    });
  }

  function createSession(userId, request, reply) {
    deleteExpiredSessions();
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    database
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(hashToken(token), userId, now + sessionMaxAgeSeconds * 1000, now, now);
    setSessionCookie(request, reply, token);
  }

  function authenticate(request, reply) {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "需要登录");

    const tokenHash = hashToken(token);
    const session = database
      .prepare(
        `SELECT sessions.user_id, sessions.expires_at, users.*
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ?`,
      )
      .get(tokenHash);
    if (!session || session.expires_at <= Date.now()) {
      if (session) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      clearSessionCookie(reply);
      throw new ApiError(401, "SESSION_EXPIRED", "会话无效或已过期");
    }

    const now = Date.now();
    database
      .prepare("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?")
      .run(now + sessionMaxAgeSeconds * 1000, now, tokenHash);
    setSessionCookie(request, reply, token);
    return session;
  }

  function checkLoginRateLimit(request, normalizedUsername) {
    const key = `login:${request.ip}:${normalizedUsername}`;
    checkRequestRateLimit(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    return () => loginAttempts.delete(key);
  }

  function checkRequestRateLimit(key, maximumAttempts, windowMs) {
    const now = Date.now();
    const recentAttempts = (loginAttempts.get(key) ?? []).filter(
      (attemptedAt) => attemptedAt > now - windowMs,
    );
    if (recentAttempts.length >= maximumAttempts) {
      throw new ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
    }
    recentAttempts.push(now);
    loginAttempts.set(key, recentAttempts);
  }

  app.post("/api/splayer/register", async (request, reply) => {
    const body = requireObject(request.body, "request");
    const { displayName, normalizedUsername } = normalizeUsername(body.username);
    const authSecret = requireAuthSecret(body.authSecret);
    const encryption = requireEncryption(body.encryption);
    const vault = requireVault(body.vault);
    const recoveryVerifier = requireAuthSecret(body.recoveryVerifier, "recoveryVerifier");
    checkRequestRateLimit(
      `register:${request.ip}`,
      REGISTRATION_MAX_ATTEMPTS,
      REGISTRATION_WINDOW_MS,
    );
    const accountCount = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    if (accountCount >= maxAccounts) {
      throw new ApiError(503, "REGISTRATION_CAPACITY_REACHED", "服务器账户容量已满");
    }
    const { salt, hash } = await hashPassword(authSecret);
    const user = {
      id: randomUUID(),
      username: displayName,
      normalized_username: normalizedUsername,
      must_change_password: 0,
    };
    const now = Date.now();

    try {
      database.transaction(() => {
        database
          .prepare(
            `INSERT INTO users
             (id, username, normalized_username, password_salt, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(user.id, user.username, normalizedUsername, salt, hash, now, now);
        database
          .prepare(
            "INSERT INTO encryptions (user_id, envelope_json, recovery_verifier) VALUES (?, ?, ?)",
          )
          .run(user.id, JSON.stringify(encryption), recoveryVerifier);
        database
          .prepare(
            "INSERT INTO vaults (user_id, vault_json, revision, updated_at) VALUES (?, ?, 1, ?)",
          )
          .run(user.id, JSON.stringify(vault), now);
      })();
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new ApiError(409, "USERNAME_TAKEN", "用户名已存在");
      }
      throw error;
    }

    createSession(user.id, request, reply);
    return reply.code(201).send(accountResponse(database, user));
  });

  app.post("/api/splayer/login", async (request, reply) => {
    const body = requireObject(request.body, "request");
    const { normalizedUsername } = normalizeUsername(body.username);
    const authSecret = requireAuthSecret(body.authSecret);
    const clearRateLimit = checkLoginRateLimit(request, normalizedUsername);
    const user = database
      .prepare("SELECT * FROM users WHERE normalized_username = ?")
      .get(normalizedUsername);
    const passwordSalt = user?.password_salt ?? dummyPassword.salt;
    const passwordHash = user?.password_hash ?? dummyPassword.hash;
    const passwordMatches = await verifyPassword(authSecret, passwordSalt, passwordHash);

    if (!user || !passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    if (user.must_change_password && user.temporary_password_used) {
      throw new ApiError(401, "TEMPORARY_PASSWORD_USED", "临时密码已使用，请联系管理员重新生成");
    }

    clearRateLimit();
    if (user.must_change_password) {
      database
        .prepare("UPDATE users SET temporary_password_used = 1, updated_at = ? WHERE id = ?")
        .run(Date.now(), user.id);
    }
    createSession(user.id, request, reply);
    return accountResponse(database, user);
  });

  app.get("/api/splayer/session", async (request, reply) => {
    const user = authenticate(request, reply);
    return accountResponse(database, user);
  });

  app.post("/api/splayer/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/api/splayer/vault", async (request, reply) => {
    const user = authenticate(request, reply);
    const vault = database
      .prepare("SELECT vault_json, revision FROM vaults WHERE user_id = ?")
      .get(user.id);
    return { vault: parseJson(vault.vault_json), revision: vault.revision };
  });

  app.put("/api/splayer/vault", async (request, reply) => {
    const user = authenticate(request, reply);
    if (user.must_change_password) {
      throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "必须先使用恢复密钥设置新密码");
    }
    const body = requireObject(request.body, "request");
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) {
      throw new ApiError(400, "INVALID_REQUEST", "revision 格式无效");
    }
    const vault = requireVault(body.vault);
    const result = database
      .prepare(
        `UPDATE vaults SET vault_json = ?, revision = revision + 1, updated_at = ?
         WHERE user_id = ? AND revision = ?`,
      )
      .run(JSON.stringify(vault), Date.now(), user.id, body.revision);
    if (result.changes === 0) {
      const current = database
        .prepare("SELECT revision FROM vaults WHERE user_id = ?")
        .get(user.id);
      throw new ApiError(409, "REVISION_CONFLICT", "保险库版本冲突", {
        revision: current.revision,
      });
    }
    return { vault, revision: body.revision + 1 };
  });

  app.post("/api/splayer/password", async (request, reply) => {
    const user = authenticate(request, reply);
    const body = requireObject(request.body, "request");
    const currentAuthSecret = requireAuthSecret(body.currentAuthSecret, "currentAuthSecret");
    const newAuthSecret = requireAuthSecret(body.newAuthSecret, "newAuthSecret");
    const passwordEncryption = requirePasswordEncryption(body.passwordEncryption);
    if (!(await verifyPassword(currentAuthSecret, user.password_salt, user.password_hash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "当前密码错误");
    }

    if (user.must_change_password) {
      const recoveryProof = requireAuthSecret(body.recoveryProof, "recoveryProof");
      const recoveryRecord = database
        .prepare("SELECT recovery_verifier FROM encryptions WHERE user_id = ?")
        .get(user.id);
      const suppliedProof = Buffer.from(recoveryProof);
      const expectedProof = Buffer.from(recoveryRecord?.recovery_verifier || "");
      if (
        suppliedProof.length !== expectedProof.length ||
        !timingSafeEqual(suppliedProof, expectedProof)
      ) {
        throw new ApiError(403, "RECOVERY_PROOF_REQUIRED", "恢复密钥验证失败");
      }
    }

    const { salt, hash } = await hashPassword(newAuthSecret);
    const currentEnvelope = database
      .prepare("SELECT envelope_json FROM encryptions WHERE user_id = ?")
      .get(user.id);
    const envelope = parseJson(currentEnvelope.envelope_json);
    envelope.kdfSalt = passwordEncryption.kdfSalt;
    envelope.kdfIterations = passwordEncryption.kdfIterations;
    envelope.wrappedVaultKey = passwordEncryption.wrappedVaultKey;
    const now = Date.now();

    database.transaction(() => {
      database
        .prepare(
          `UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 0,
           temporary_password_used = 0, updated_at = ? WHERE id = ?`,
        )
        .run(salt, hash, now, user.id);
      database
        .prepare("UPDATE encryptions SET envelope_json = ? WHERE user_id = ?")
        .run(JSON.stringify(envelope), user.id);
      database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    })();

    createSession(user.id, request, reply);
    const updatedUser = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    return accountResponse(database, updatedUser);
  });

  app.post("/api/splayer/admin/reset-password", async (request, _reply) => {
    const adminToken = options.adminToken ?? process.env.SPLAYER_ADMIN_TOKEN;
    if (!adminToken) {
      throw new ApiError(503, "ADMIN_DISABLED", "管理员密码重置未启用");
    }
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const suppliedHash = hashToken(suppliedToken);
    const expectedHash = hashToken(adminToken);
    if (!suppliedToken || !timingSafeEqual(suppliedHash, expectedHash)) {
      throw new ApiError(401, "INVALID_ADMIN_TOKEN", "管理员令牌无效");
    }

    const body = requireObject(request.body, "request");
    const { normalizedUsername } = normalizeUsername(body.username);
    const user = database
      .prepare("SELECT * FROM users WHERE normalized_username = ?")
      .get(normalizedUsername);
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");

    const temporaryPassword = randomBytes(18).toString("base64url");
    const temporaryAuthSecret = deriveAuthenticationSecret(user.username, temporaryPassword);
    const { salt, hash } = await hashPassword(temporaryAuthSecret);
    database.transaction(() => {
      database
        .prepare(
          `UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 1,
           temporary_password_used = 0, updated_at = ? WHERE id = ?`,
        )
        .run(salt, hash, Date.now(), user.id);
      database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    })();

    return {
      user: { ...publicUser(user), mustChangePassword: true },
      temporaryPassword,
      recoveryRequired: true,
    };
  });

  return app;
}
