import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const migrations = [
  `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      normalized_username TEXT NOT NULL UNIQUE,
      password_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE encryptions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      envelope_json TEXT NOT NULL
    );

    CREATE TABLE vaults (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      vault_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      token_hash BLOB PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE INDEX sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
  `,
  `
    ALTER TABLE users ADD COLUMN temporary_password_used INTEGER NOT NULL DEFAULT 0;
  `,
  `
    ALTER TABLE encryptions ADD COLUMN recovery_verifier TEXT;
  `,
];

export function openDatabase(databasePath) {
  const databaseDirectory = dirname(databasePath);
  mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
  chmodSync(databaseDirectory, 0o700);
  const database = new Database(databasePath);
  chmodSync(databasePath, 0o600);

  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedVersions = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map(({ version }) => version),
  );
  const applyMigration = database.transaction((version, sql) => {
    database.exec(sql);
    database
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(version, Date.now());
  });

  migrations.forEach((sql, index) => {
    const version = index + 1;
    if (!appliedVersions.has(version)) applyMigration(version, sql);
  });

  return database;
}
