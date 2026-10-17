import type Database from 'better-sqlite3';

export interface DatabaseMigration {
  version: number;
  name: string;
  sql: string;
}

export const SONORA_MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    name: '001_initial_sonora_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        language TEXT NOT NULL DEFAULT 'pt-PT' CHECK (language IN ('pt-PT', 'en')),
        default_volume INTEGER NOT NULL DEFAULT 80 CHECK (default_volume >= 0 AND default_volume <= 200),
        dj_only_mode INTEGER NOT NULL DEFAULT 0 CHECK (dj_only_mode IN (0, 1)),
        stay_in_voice INTEGER NOT NULL DEFAULT 0 CHECK (stay_in_voice IN (0, 1)),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        language TEXT NOT NULL DEFAULT 'pt-PT' CHECK (language IN ('pt-PT', 'en')),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dj_roles (
        guild_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      );

      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration_ms INTEGER,
        artwork_url TEXT,
        source TEXT NOT NULL CHECK (source IN ('youtube', 'soundcloud', 'direct')),
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, track_id)
      );

      CREATE INDEX IF NOT EXISTS idx_favorites_user_created
        ON favorites (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_playlists_user_updated
        ON playlists (user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration_ms INTEGER,
        artwork_url TEXT,
        source TEXT NOT NULL CHECK (source IN ('youtube', 'soundcloud', 'direct')),
        source_url TEXT NOT NULL,
        added_at TEXT NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
        ON playlist_tracks (playlist_id, position ASC);

      CREATE TABLE IF NOT EXISTS playback_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration_ms INTEGER,
        artwork_url TEXT,
        source TEXT NOT NULL CHECK (source IN ('youtube', 'soundcloud', 'direct')),
        source_url TEXT NOT NULL,
        requested_by_id TEXT,
        requested_by_name TEXT,
        played_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_playback_history_guild_played
        ON playback_history (guild_id, played_at DESC);

      CREATE TABLE IF NOT EXISTS web_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        guild_id TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_dj INTEGER NOT NULL DEFAULT 0,
        role_ids_json TEXT NOT NULL DEFAULT '[]',
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_web_sessions_expires
        ON web_sessions (expires_at);
    `
  }
];

export function runMigrations(db: Database.Database): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
    .all() as Array<{ version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const newlyApplied: number[] = [];
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of SONORA_MIGRATIONS) {
    if (appliedSet.has(migration.version)) continue;

    const applyTx = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
    });

    applyTx();
    newlyApplied.push(migration.version);
  }

  return newlyApplied;
}
