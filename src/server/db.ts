import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { generateId, hashPassword } from './security.ts';

const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
export const VIDEOS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'videos');
export const THUMBNAILS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'thumbnails');
export const TMP_UPLOAD_DIR = path.join(UPLOADS_DIR, 'tmp');

for (const dir of [DATA_DIR, UPLOADS_DIR, VIDEOS_UPLOAD_DIR, THUMBNAILS_UPLOAD_DIR, TMP_UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'linkplayhd.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login INTEGER
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL CHECK(source_type IN ('upload', 'external')),
    source_url TEXT NOT NULL DEFAULT '',
    storage_path TEXT NOT NULL DEFAULT '',
    quality_sources TEXT NOT NULL DEFAULT '[]',
    skip_intro_seconds INTEGER NOT NULL DEFAULT 37,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'Movies',
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft', 'disabled')),
    featured INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    watched_duration INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_video_views_unique_session
    ON video_views(video_id, session_id);

  CREATE TABLE IF NOT EXISTS live_sessions (
    session_id TEXT PRIMARY KEY,
    video_id TEXT,
    device_type TEXT NOT NULL DEFAULT 'Desktop',
    browser TEXT NOT NULL DEFAULT 'Other',
    user_agent TEXT NOT NULL DEFAULT '',
    last_heartbeat INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics(created_at);
  CREATE INDEX IF NOT EXISTS idx_analytics_video_id ON analytics(video_id);
  CREATE INDEX IF NOT EXISTS idx_live_sessions_heartbeat ON live_sessions(last_heartbeat);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Safe schema migration for existing databases
try {
  db.exec('ALTER TABLE videos ADD COLUMN skip_intro_seconds INTEGER NOT NULL DEFAULT 37');
} catch {
  // Column already exists
}

function seedInitialData() {
  const now = Date.now();

  // Seed default admin account securely using salted scrypt hash
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (adminCount.count === 0) {
    const initialUsername = process.env.ADMIN_INITIAL_USERNAME || 'SAMVIR32';
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'SAMARTH4';
    db.prepare(
      'INSERT INTO admins (username, password_hash, created_at, last_login) VALUES (?, ?, ?, NULL)'
    ).run(initialUsername, hashPassword(initialPassword), now);
  }

  // Seed default platform, watermark, and protection settings
  const defaultSettings: Record<string, string> = {
    telegram_channel: '@NETWORKBOYOU',
    telegram_contact: '@SAMVIIR',
    related_videos_enabled: 'true',
    site_tagline: 'Ultra-HD Streaming & Protected Watch Links',
    watermark_enabled: 'true',
    watermark_text: 'LINKPLAYHD · @SAMVIIR',
    watermark_image_url: '',
    default_skip_intro: '37',
    screen_shield_enabled: 'true',
  };
  const upsertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaultSettings)) {
    upsertSetting.run(key, value);
  }

  // Remove old seeded demo videos once while preserving all admin-added videos
  const cleanedDemos = db
    .prepare("SELECT value FROM settings WHERE key = 'cleanup_demos_v1'")
    .get() as { value: string } | undefined;
  if (!cleanedDemos) {
    db.prepare(
      "DELETE FROM videos WHERE id IN ('playhd01', 'hlsdemo1', 'noirfilm', 'abyssdoc', 'canyon01', 'rainnoir', 'alpine01')"
    ).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cleanup_demos_v1', 'done')").run();
  }
}

seedInitialData();

export function getSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export function cleanupExpiredSessions(maxAgeMs = 65_000): number {
  const cutoff = Date.now() - maxAgeMs;
  const info = db.prepare('DELETE FROM live_sessions WHERE last_heartbeat < ?').run(cutoff);
  return info.changes;
}

export function createUniqueVideoId(): string {
  for (let i = 0; i < 10; i++) {
    const candidate = generateId(8);
    const exists = db.prepare('SELECT 1 FROM videos WHERE id = ?').get(candidate);
    if (!exists) return candidate;
  }
  return generateId(10);
}
