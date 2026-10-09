import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'servervault.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA secure_delete = ON;
  PRAGMA busy_timeout = 3000;

  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kdf_salt            BLOB NOT NULL,
    kdf_params          TEXT NOT NULL,
    auth_hash           BLOB NOT NULL,
    wrapped_dek         BLOB NOT NULL,
    totp_secret         BLOB,
    totp_last_step      INTEGER NOT NULL DEFAULT 0,
    recovery_codes      TEXT,
    failed_logins       INTEGER NOT NULL DEFAULT 0,
    locked_until        INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS icons (
    id         INTEGER PRIMARY KEY,
    domain     TEXT NOT NULL UNIQUE,
    mime       TEXT,
    data       BLOB,
    site_name  TEXT,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS servers (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'vds',
    host           TEXT NOT NULL,
    port           INTEGER NOT NULL DEFAULT 22,
    login_enc      BLOB,
    password_enc   BLOB,
    notes_enc      BLOB,
    hosting_url    TEXT,
    hosting_name   TEXT,
    hosting_domain TEXT,
    pay_date       TEXT NOT NULL,
    period         TEXT NOT NULL DEFAULT 'month',
    price          REAL,
    currency       TEXT,
    remind         INTEGER NOT NULL DEFAULT 1,
    monitor        INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY,
    server_id   INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    server_name TEXT NOT NULL,
    due_date    TEXT,
    amount      REAL,
    currency    TEXT,
    paid_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders_sent (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    due_date  TEXT NOT NULL,
    mark      INTEGER NOT NULL,
    sent_at   INTEGER NOT NULL,
    PRIMARY KEY (server_id, due_date, mark)
  );

  CREATE TABLE IF NOT EXISTS audit (
    id     INTEGER PRIMARY KEY,
    ts     INTEGER NOT NULL,
    event  TEXT NOT NULL,
    ip     TEXT,
    ua     TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

/* ───── миграции для существующих баз ───── */

function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'admin'");
addColumn('users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'created_by', 'INTEGER');
addColumn('users', 'last_login_at', 'INTEGER');
addColumn('servers', 'owner_id', 'INTEGER');
addColumn('audit', 'actor', 'TEXT');

const statements = new Map();
/** Подготовленное выражение с кэшем. Все запросы только через параметры — никакой конкатенации. */
export function q(sql) {
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, def = null) {
  const row = q('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}

export function setSetting(key, value) {
  if (value == null) q('DELETE FROM settings WHERE key = ?').run(key);
  else q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
