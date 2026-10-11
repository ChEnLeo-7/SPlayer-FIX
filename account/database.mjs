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
  `
    CREATE TABLE account_sync_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      sync_version INTEGER NOT NULL DEFAULT 1 CHECK (sync_version IN (1, 2)),
      head_cursor INTEGER NOT NULL DEFAULT 0 CHECK (head_cursor >= 0),
      operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
      operation_bytes INTEGER NOT NULL DEFAULT 0 CHECK (operation_bytes >= 0),
      migrated_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE vault_operations (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cursor INTEGER NOT NULL CHECK (cursor > 0),
      operation_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL CHECK (device_seq > 0),
      base_cursor INTEGER NOT NULL CHECK (base_cursor >= 0),
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, cursor),
      UNIQUE (user_id, operation_id)
    );

    CREATE INDEX vault_operations_user_device_idx
      ON vault_operations(user_id, device_id, device_seq DESC);

    INSERT INTO account_sync_state (user_id, updated_at)
      SELECT id, updated_at FROM users;
  `,
  `
    CREATE TABLE vault_operations_v2 (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cursor INTEGER NOT NULL CHECK (cursor > 0),
      operation_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL CHECK (device_seq > 0),
      base_cursor INTEGER NOT NULL CHECK (base_cursor >= 0),
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, cursor),
      UNIQUE (user_id, operation_id)
    );

    INSERT INTO vault_operations_v2
      SELECT * FROM vault_operations;
    DROP TABLE vault_operations;
    ALTER TABLE vault_operations_v2 RENAME TO vault_operations;

    CREATE INDEX vault_operations_user_device_idx
      ON vault_operations(user_id, device_id, device_seq DESC);
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
