// SQLite 数据层：schema、迁移、通用查询封装
// 使用 Node 内置 node:sqlite（零第三方依赖）
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  status        TEXT NOT NULL DEFAULT 'active',
  avatar_color  TEXT NOT NULL DEFAULT '#5B9BF3',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#5B9BF3',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_user_name ON groups(user_id, name);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '📌',
  color       TEXT NOT NULL DEFAULT '#5B9BF3',
  mode        TEXT NOT NULL DEFAULT 'checkin',
  description TEXT NOT NULL DEFAULT '',
  fields      TEXT NOT NULL DEFAULT '[]',
  goal_value  INTEGER NOT NULL DEFAULT 0,
  goal_period TEXT NOT NULL DEFAULT 'month',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id, sort_order);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  occurred_at INTEGER NOT NULL,
  day_key     TEXT NOT NULL,
  values_json TEXT NOT NULL DEFAULT '{}',
  note        TEXT NOT NULL DEFAULT '',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  duration    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_day ON entries(user_id, day_key);
CREATE INDEX IF NOT EXISTS idx_entries_tpl ON entries(template_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_entries_user_time ON entries(user_id, occurred_at DESC);
`;

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}

/** node:sqlite 返回 null 原型对象，统一转成普通对象 */
export function plain(row) {
  return row ? { ...row } : row;
}
export function plainAll(rows) {
  return rows.map((r) => ({ ...r }));
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/** 系统是否已完成初始化（即是否已存在管理员） */
export function isInitialized(db) {
  if (getSetting(db, 'initialized') === '1') return true;
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get();
  return Number(row?.n ?? 0) > 0;
}

/** 把 JSON 文本列解析出来，供前端直接消费 */
export function decodeTemplate(row) {
  if (!row) return row;
  const t = { ...row };
  try {
    t.fields = JSON.parse(t.fields ?? '[]');
  } catch {
    t.fields = [];
  }
  if (t.group_id === undefined) t.group_id = null;
  return t;
}

export function decodeEntry(row) {
  if (!row) return row;
  const e = { ...row };
  try {
    e.values = JSON.parse(e.values_json ?? '{}');
  } catch {
    e.values = {};
  }
  try {
    e.tags = JSON.parse(e.tags_json ?? '[]');
  } catch {
    e.tags = [];
  }
  delete e.values_json;
  delete e.tags_json;
  return e;
}
