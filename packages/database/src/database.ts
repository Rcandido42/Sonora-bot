import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  DjRole,
  FavoriteTrack,
  GuildSettings,
  PlaybackHistoryEntry,
  Playlist,
  PlaylistTrackItem,
  SupportedLocale
} from '@sonora/shared';
import { runMigrations } from './migrations.js';
import {
  CreatePlaylistInputSchema,
  DjRoleInputSchema,
  GuildSettingsUpdateSchema,
  PersistableTrackSchema,
  SessionRecordInputSchema,
  SupportedLocaleSchema,
  UpdatePlaylistInputSchema
} from './validators.js';
import type { z } from 'zod';

export interface WebSessionRecord {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  guildId: string;
  isAdmin: boolean;
  isDj: boolean;
  roleIds: string[];
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export class SonoraDatabase {
  public readonly db: Database.Database;
  public readonly dbPath: string;
  private readonly defaultLanguage: SupportedLocale;

  constructor(dbPath = ':memory:', defaultLanguage: SupportedLocale = 'pt-PT') {
    this.dbPath = dbPath;
    this.defaultLanguage = defaultLanguage;

    if (dbPath !== ':memory:') {
      const resolvedDir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');

    runMigrations(this.db);
  }

  public getAppliedMigrations(): Array<{ version: number; name: string; appliedAt: string }> {
    const rows = this.db
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number; name: string; applied_at: string }>;

    return rows.map((r) => ({
      version: r.version,
      name: r.name,
      appliedAt: r.applied_at
    }));
  }

  // ===========================================================================
  // 1. Configurações do Servidor & Idioma
  // ===========================================================================

  public getGuildSettings(guildId: string): GuildSettings {
    const row = this.db
      .prepare(
        `SELECT guild_id, language, default_volume, dj_only_mode, stay_in_voice, updated_at
         FROM guild_settings WHERE guild_id = ?`
      )
      .get(guildId) as
      | {
          guild_id: string;
          language: SupportedLocale;
          default_volume: number;
          dj_only_mode: number;
          stay_in_voice: number;
          updated_at: string;
        }
      | undefined;

    if (row) {
      return {
        guildId: row.guild_id,
        language: row.language,
        defaultVolume: row.default_volume,
        djOnlyMode: Boolean(row.dj_only_mode),
        stayInVoice: Boolean(row.stay_in_voice),
        updatedAt: row.updated_at
      };
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, language, default_volume, dj_only_mode, stay_in_voice, updated_at)
         VALUES (?, ?, 80, 0, 0, ?)`
      )
      .run(guildId, this.defaultLanguage, now);

    return {
      guildId,
      language: this.defaultLanguage,
      defaultVolume: 80,
      djOnlyMode: false,
      stayInVoice: false,
      updatedAt: now
    };
  }

  public updateGuildSettings(
    guildId: string,
    patch: z.input<typeof GuildSettingsUpdateSchema>
  ): GuildSettings {
    const validated = GuildSettingsUpdateSchema.parse(patch);
    const current = this.getGuildSettings(guildId);
    const next: GuildSettings = {
      guildId,
      language: validated.language ?? current.language,
      defaultVolume: validated.defaultVolume ?? current.defaultVolume,
      djOnlyMode: validated.djOnlyMode ?? current.djOnlyMode,
      stayInVoice: validated.stayInVoice ?? current.stayInVoice,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `UPDATE guild_settings
         SET language = ?, default_volume = ?, dj_only_mode = ?, stay_in_voice = ?, updated_at = ?
         WHERE guild_id = ?`
      )
      .run(
        next.language,
        next.defaultVolume,
        next.djOnlyMode ? 1 : 0,
        next.stayInVoice ? 1 : 0,
        next.updatedAt,
        guildId
      );

    return next;
  }

  public getUserLanguage(userId: string): SupportedLocale | null {
    const row = this.db
      .prepare('SELECT language FROM user_preferences WHERE user_id = ?')
      .get(userId) as { language: SupportedLocale } | undefined;
    return row?.language ?? null;
  }

  public setUserLanguage(userId: string, language: SupportedLocale): SupportedLocale {
    const validLocale = SupportedLocaleSchema.parse(language);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_preferences (user_id, language, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at`
      )
      .run(userId, validLocale, now);
    return validLocale;
  }

  // ===========================================================================
  // 2. Cargos de DJ
  // ===========================================================================

  public getDjRoles(guildId: string): DjRole[] {
    const rows = this.db
      .prepare(
        `SELECT guild_id, role_id, role_name, added_at
         FROM dj_roles WHERE guild_id = ? ORDER BY role_name ASC`
      )
      .all(guildId) as Array<{
      guild_id: string;
      role_id: string;
      role_name: string;
      added_at: string;
    }>;

    return rows.map((r) => ({
      guildId: r.guild_id,
      roleId: r.role_id,
      roleName: r.role_name,
      addedAt: r.added_at
    }));
  }

  public addDjRole(guildId: string, roleId: string, roleName: string): DjRole[] {
    const valid = DjRoleInputSchema.parse({ guildId, roleId, roleName });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO dj_roles (guild_id, role_id, role_name, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, role_id) DO UPDATE SET role_name = excluded.role_name`
      )
      .run(valid.guildId, valid.roleId, valid.roleName, now);

    return this.getDjRoles(guildId);
  }

  public removeDjRole(guildId: string, roleId: string): DjRole[] {
    this.db.prepare('DELETE FROM dj_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
    return this.getDjRoles(guildId);
  }

  public replaceDjRoles(
    guildId: string,
    roles: Array<{ roleId: string; roleName: string }>
  ): DjRole[] {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM dj_roles WHERE guild_id = ?').run(guildId);
      const insert = this.db.prepare(
        'INSERT INTO dj_roles (guild_id, role_id, role_name, added_at) VALUES (?, ?, ?, ?)'
      );
      for (const r of roles) {
        const valid = DjRoleInputSchema.parse({ guildId, ...r });
        insert.run(valid.guildId, valid.roleId, valid.roleName, now);
      }
    });
    tx();
    return this.getDjRoles(guildId);
  }

  // ===========================================================================
  // 3. Favoritos Pessoais
  // ===========================================================================

  public getFavorites(userId: string): FavoriteTrack[] {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, track_id, title, artist, duration_ms, artwork_url, source, source_url, created_at
         FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC`
      )
      .all(userId) as Array<{
      id: number;
      user_id: string;
      track_id: string;
      title: string;
      artist: string;
      duration_ms: number | null;
      artwork_url: string | null;
      source: 'youtube' | 'soundcloud' | 'direct';
      source_url: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      trackId: r.track_id,
      title: r.title,
      artist: r.artist,
      durationMs: r.duration_ms,
      artworkUrl: r.artwork_url,
      source: r.source,
      sourceUrl: r.source_url,
      createdAt: r.created_at
    }));
  }

  public isFavorite(userId: string, trackId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM favorites WHERE user_id = ? AND track_id = ?')
      .get(userId, trackId);
    return Boolean(row);
  }

  public addFavorite(
    userId: string,
    trackInput: z.input<typeof PersistableTrackSchema>
  ): { added: boolean; item: FavoriteTrack } {
    const track = PersistableTrackSchema.parse(trackInput);
    const now = new Date().toISOString();

    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO favorites
          (user_id, track_id, title, artist, duration_ms, artwork_url, source, source_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        track.id,
        track.title,
        track.artist,
        track.durationMs,
        track.artworkUrl,
        track.source,
        track.sourceUrl,
        now
      );

    const row = this.db
      .prepare(
        `SELECT id, user_id, track_id, title, artist, duration_ms, artwork_url, source, source_url, created_at
         FROM favorites WHERE user_id = ? AND track_id = ?`
      )
      .get(userId, track.id) as {
      id: number;
      user_id: string;
      track_id: string;
      title: string;
      artist: string;
      duration_ms: number | null;
      artwork_url: string | null;
      source: 'youtube' | 'soundcloud' | 'direct';
      source_url: string;
      created_at: string;
    };

    return {
      added: result.changes > 0,
      item: {
        id: row.id,
        userId: row.user_id,
        trackId: row.track_id,
        title: row.title,
        artist: row.artist,
        durationMs: row.duration_ms,
        artworkUrl: row.artwork_url,
        source: row.source,
        sourceUrl: row.source_url,
        createdAt: row.created_at
      }
    };
  }

  public removeFavorite(userId: string, trackId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?')
      .run(userId, trackId);
    return res.changes > 0;
  }

  public toggleFavorite(
    userId: string,
    trackInput: z.input<typeof PersistableTrackSchema>
  ): { favorited: boolean; item?: FavoriteTrack } {
    const track = PersistableTrackSchema.parse(trackInput);
    if (this.isFavorite(userId, track.id)) {
      this.removeFavorite(userId, track.id);
      return { favorited: false };
    }
    const { item } = this.addFavorite(userId, track);
    return { favorited: true, item };
  }

  // ===========================================================================
  // 4. Playlists Pessoais & Faixas Guardadas
  // ===========================================================================

  public getPlaylistsByUser(userId: string, guildId?: string): Playlist[] {
    const query = guildId
      ? `SELECT p.id, p.user_id, p.guild_id, p.name, p.description, p.created_at, p.updated_at,
                COUNT(pt.id) AS track_count
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         WHERE p.user_id = ? AND p.guild_id = ?
         GROUP BY p.id
         ORDER BY p.updated_at DESC, p.id DESC`
      : `SELECT p.id, p.user_id, p.guild_id, p.name, p.description, p.created_at, p.updated_at,
                COUNT(pt.id) AS track_count
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         WHERE p.user_id = ?
         GROUP BY p.id
         ORDER BY p.updated_at DESC, p.id DESC`;

    const rows = (
      guildId
        ? this.db.prepare(query).all(userId, guildId)
        : this.db.prepare(query).all(userId)
    ) as Array<{
      id: number;
      user_id: string;
      guild_id: string;
      name: string;
      description: string | null;
      created_at: string;
      updated_at: string;
      track_count: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      guildId: r.guild_id,
      name: r.name,
      description: r.description,
      trackCount: Number(r.track_count),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getPlaylistById(playlistId: number, userId?: string): Playlist | null {
    const row = (
      userId
        ? this.db
            .prepare(
              `SELECT id, user_id, guild_id, name, description, created_at, updated_at
               FROM playlists WHERE id = ? AND user_id = ?`
            )
            .get(playlistId, userId)
        : this.db
            .prepare(
              `SELECT id, user_id, guild_id, name, description, created_at, updated_at
               FROM playlists WHERE id = ?`
            )
            .get(playlistId)
    ) as
      | {
          id: number;
          user_id: string;
          guild_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    const trackRows = this.db
      .prepare(
        `SELECT id, playlist_id, position, track_id, title, artist, duration_ms, artwork_url, source, source_url, added_at
         FROM playlist_tracks
         WHERE playlist_id = ?
         ORDER BY position ASC, id ASC`
      )
      .all(playlistId) as Array<{
      id: number;
      playlist_id: number;
      position: number;
      track_id: string;
      title: string;
      artist: string;
      duration_ms: number | null;
      artwork_url: string | null;
      source: 'youtube' | 'soundcloud' | 'direct';
      source_url: string;
      added_at: string;
    }>;

    const tracks: PlaylistTrackItem[] = trackRows.map((t) => ({
      id: t.id,
      playlistId: t.playlist_id,
      position: t.position,
      trackId: t.track_id,
      title: t.title,
      artist: t.artist,
      durationMs: t.duration_ms,
      artworkUrl: t.artwork_url,
      source: t.source,
      sourceUrl: t.source_url,
      addedAt: t.added_at
    }));

    return {
      id: row.id,
      userId: row.user_id,
      guildId: row.guild_id,
      name: row.name,
      description: row.description,
      trackCount: tracks.length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tracks
    };
  }

  public createPlaylist(input: z.input<typeof CreatePlaylistInputSchema>): Playlist {
    const valid = CreatePlaylistInputSchema.parse(input);
    const now = new Date().toISOString();

    const res = this.db
      .prepare(
        `INSERT INTO playlists (user_id, guild_id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(valid.userId, valid.guildId, valid.name, valid.description, now, now);

    const playlist = this.getPlaylistById(Number(res.lastInsertRowid), valid.userId);
    if (!playlist) {
      throw new Error('Falha ao criar a playlist.');
    }
    return playlist;
  }

  public updatePlaylist(
    playlistId: number,
    userId: string,
    input: z.input<typeof UpdatePlaylistInputSchema>
  ): Playlist {
    const valid = UpdatePlaylistInputSchema.parse(input);
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE playlists SET name = ?, description = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(valid.name, valid.description, now, playlistId, userId);

    if (res.changes === 0) {
      throw new Error('Playlist não encontrada ou sem permissão.');
    }

    const updated = this.getPlaylistById(playlistId, userId);
    if (!updated) {
      throw new Error('Playlist não encontrada.');
    }
    return updated;
  }

  public deletePlaylist(playlistId: number, userId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?')
      .run(playlistId, userId);
    return res.changes > 0;
  }

  public addTrackToPlaylist(
    playlistId: number,
    userId: string,
    trackInput: z.input<typeof PersistableTrackSchema>
  ): PlaylistTrackItem {
    const track = PersistableTrackSchema.parse(trackInput);
    const ownerCheck = this.db
      .prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?')
      .get(playlistId, userId);

    if (!ownerCheck) {
      throw new Error('Playlist não encontrada ou sem permissão.');
    }

    const now = new Date().toISOString();
    let insertedId = 0;
    let nextPos = 1;

    const tx = this.db.transaction(() => {
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(position), 0) AS max_pos FROM playlist_tracks WHERE playlist_id = ?')
        .get(playlistId) as { max_pos: number };
      nextPos = Number(maxRow.max_pos) + 1;

      const res = this.db
        .prepare(
          `INSERT INTO playlist_tracks
            (playlist_id, position, track_id, title, artist, duration_ms, artwork_url, source, source_url, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          playlistId,
          nextPos,
          track.id,
          track.title,
          track.artist,
          track.durationMs,
          track.artworkUrl,
          track.source,
          track.sourceUrl,
          now
        );

      insertedId = Number(res.lastInsertRowid);
      this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);
    });

    tx();

    return {
      id: insertedId,
      playlistId,
      position: nextPos,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
      artworkUrl: track.artworkUrl,
      source: track.source,
      sourceUrl: track.sourceUrl,
      addedAt: now
    };
  }

  public removeTrackFromPlaylist(
    playlistId: number,
    userId: string,
    playlistTrackItemId: number
  ): boolean {
    const ownerCheck = this.db
      .prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?')
      .get(playlistId, userId);

    if (!ownerCheck) {
      throw new Error('Playlist não encontrada ou sem permissão.');
    }

    let removed = false;
    const tx = this.db.transaction(() => {
      const res = this.db
        .prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?')
        .run(playlistTrackItemId, playlistId);
      removed = res.changes > 0;

      if (removed) {
        const remaining = this.db
          .prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, id ASC')
          .all(playlistId) as Array<{ id: number }>;

        const updatePos = this.db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ?');
        remaining.forEach((row, idx) => {
          updatePos.run(idx + 1, row.id);
        });

        this.db
          .prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
          .run(new Date().toISOString(), playlistId);
      }
    });

    tx();
    return removed;
  }

  // ===========================================================================
  // 5. Histórico de Reprodução
  // ===========================================================================

  public addHistoryEntry(
    guildId: string,
    trackInput: z.input<typeof PersistableTrackSchema>,
    maxEntriesPerGuild = 200
  ): PlaybackHistoryEntry {
    const track = PersistableTrackSchema.parse(trackInput);
    const now = new Date().toISOString();
    const requestedById = track.requestedBy?.id ?? null;
    const requestedByName =
      track.requestedBy?.displayName ?? track.requestedBy?.username ?? null;

    let entryId = 0;
    const tx = this.db.transaction(() => {
      const res = this.db
        .prepare(
          `INSERT INTO playback_history
            (guild_id, track_id, title, artist, duration_ms, artwork_url, source, source_url, requested_by_id, requested_by_name, played_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          guildId,
          track.id,
          track.title,
          track.artist,
          track.durationMs,
          track.artworkUrl,
          track.source,
          track.sourceUrl,
          requestedById,
          requestedByName,
          now
        );

      entryId = Number(res.lastInsertRowid);

      // Mantém apenas as últimas maxEntriesPerGuild entradas por servidor
      this.db
        .prepare(
          `DELETE FROM playback_history
           WHERE guild_id = ? AND id NOT IN (
             SELECT id FROM playback_history
             WHERE guild_id = ?
             ORDER BY played_at DESC, id DESC
             LIMIT ?
           )`
        )
        .run(guildId, guildId, maxEntriesPerGuild);
    });

    tx();

    return {
      id: entryId,
      guildId,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
      artworkUrl: track.artworkUrl,
      source: track.source,
      sourceUrl: track.sourceUrl,
      requestedById,
      requestedByName,
      playedAt: now
    };
  }

  public getHistory(guildId: string, limit = 50): PlaybackHistoryEntry[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT id, guild_id, track_id, title, artist, duration_ms, artwork_url, source, source_url,
                requested_by_id, requested_by_name, played_at
         FROM playback_history
         WHERE guild_id = ?
         ORDER BY played_at DESC, id DESC
         LIMIT ?`
      )
      .all(guildId, safeLimit) as Array<{
      id: number;
      guild_id: string;
      track_id: string;
      title: string;
      artist: string;
      duration_ms: number | null;
      artwork_url: string | null;
      source: 'youtube' | 'soundcloud' | 'direct';
      source_url: string;
      requested_by_id: string | null;
      requested_by_name: string | null;
      played_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      trackId: r.track_id,
      title: r.title,
      artist: r.artist,
      durationMs: r.duration_ms,
      artworkUrl: r.artwork_url,
      source: r.source,
      sourceUrl: r.source_url,
      requestedById: r.requested_by_id,
      requestedByName: r.requested_by_name,
      playedAt: r.played_at
    }));
  }

  public clearHistory(guildId: string): number {
    const res = this.db.prepare('DELETE FROM playback_history WHERE guild_id = ?').run(guildId);
    return res.changes;
  }

  // ===========================================================================
  // 6. Sessões Web (Autenticação OAuth2)
  // ===========================================================================

  public createSession(input: z.input<typeof SessionRecordInputSchema>): WebSessionRecord {
    const valid = SessionRecordInputSchema.parse(input);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO web_sessions
          (session_id, user_id, username, display_name, avatar_url, guild_id, is_admin, is_dj, role_ids_json, csrf_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        valid.sessionId,
        valid.userId,
        valid.username,
        valid.displayName,
        valid.avatarUrl,
        valid.guildId,
        valid.isAdmin ? 1 : 0,
        valid.isDj ? 1 : 0,
        JSON.stringify(valid.roleIds),
        valid.csrfToken,
        now,
        valid.expiresAt
      );

    return {
      sessionId: valid.sessionId,
      userId: valid.userId,
      username: valid.username,
      displayName: valid.displayName,
      avatarUrl: valid.avatarUrl,
      guildId: valid.guildId,
      isAdmin: valid.isAdmin,
      isDj: valid.isDj,
      roleIds: valid.roleIds,
      csrfToken: valid.csrfToken,
      createdAt: now,
      expiresAt: valid.expiresAt
    };
  }

  public getSession(sessionId: string): WebSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT session_id, user_id, username, display_name, avatar_url, guild_id,
                is_admin, is_dj, role_ids_json, csrf_token, created_at, expires_at
         FROM web_sessions
         WHERE session_id = ?`
      )
      .get(sessionId) as
      | {
          session_id: string;
          user_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          guild_id: string;
          is_admin: number;
          is_dj: number;
          role_ids_json: string;
          csrf_token: string;
          created_at: string;
          expires_at: string;
        }
      | undefined;

    if (!row) return null;

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.deleteSession(sessionId);
      return null;
    }

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      guildId: row.guild_id,
      isAdmin: Boolean(row.is_admin),
      isDj: Boolean(row.is_dj),
      roleIds: JSON.parse(row.role_ids_json) as string[],
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  }

  public deleteSession(sessionId: string): boolean {
    const res = this.db.prepare('DELETE FROM web_sessions WHERE session_id = ?').run(sessionId);
    return res.changes > 0;
  }

  public deleteExpiredSessions(nowIso = new Date().toISOString()): number {
    const res = this.db.prepare('DELETE FROM web_sessions WHERE expires_at <= ?').run(nowIso);
    return res.changes;
  }

  // ===========================================================================
  // 7. Cópia de Segurança Online, Integridade e Encerramento
  // ===========================================================================

  public checkIntegrity(): boolean {
    const row = this.db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    return row?.integrity_check === 'ok';
  }

  public async backupTo(destinationFilePath: string): Promise<string> {
    const resolvedDest = path.resolve(destinationFilePath);
    fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
    await this.db.backup(resolvedDest);
    return resolvedDest;
  }

  public close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }
}
