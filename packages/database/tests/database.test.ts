import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SonoraDatabase,
  createDatabaseBackup,
  restoreDatabaseBackup
} from '../src/index.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-db-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Fase 7 — SQLite, Favoritos, Playlists, Histórico, Migrações e Backups', () => {
  it('applies migrations idempotently and manages guild settings, language and DJ roles', () => {
    const db = new SonoraDatabase(':memory:', 'pt-PT');
    expect(db.checkIntegrity()).toBe(true);
    expect(db.getAppliedMigrations()).toHaveLength(1);

    const guildId = '111222333444555666';
    const initial = db.getGuildSettings(guildId);
    expect(initial.language).toBe('pt-PT');
    expect(initial.defaultVolume).toBe(80);
    expect(initial.djOnlyMode).toBe(false);

    const updated = db.updateGuildSettings(guildId, {
      language: 'en',
      defaultVolume: 110,
      djOnlyMode: true,
      stayInVoice: true
    });
    expect(updated.language).toBe('en');
    expect(updated.defaultVolume).toBe(110);
    expect(updated.djOnlyMode).toBe(true);
    expect(updated.stayInVoice).toBe(true);

    // Preferência de idioma por utilizador
    expect(db.getUserLanguage('user-1')).toBeNull();
    db.setUserLanguage('user-1', 'en');
    expect(db.getUserLanguage('user-1')).toBe('en');

    // Cargos de DJ
    db.addDjRole(guildId, 'role-1', 'DJ Sonora');
    db.addDjRole(guildId, 'role-2', 'Sound Master');
    expect(db.getDjRoles(guildId)).toHaveLength(2);

    db.removeDjRole(guildId, 'role-1');
    expect(db.getDjRoles(guildId).map((r) => r.roleId)).toEqual(['role-2']);

    db.close();
  });

  it('manages favorites, personal playlists, ordered tracks and playback history', () => {
    const db = new SonoraDatabase(':memory:', 'pt-PT');
    const userId = 'user-42';
    const guildId = '111222333444555666';

    const trackA = {
      id: 'yt-abc123',
      title: 'Veridis Quo',
      artist: 'Daft Punk',
      durationMs: 345_000,
      artworkUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      source: 'youtube' as const,
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
      requestedBy: { id: userId, username: 'diogo', displayName: 'Diogo' }
    };

    const trackB = {
      id: 'sc-xyz789',
      title: 'Midnight City',
      artist: 'M83',
      durationMs: 243_000,
      artworkUrl: null,
      source: 'soundcloud' as const,
      sourceUrl: 'https://soundcloud.com/m83/midnight-city'
    };

    // 1. Favoritos
    const fav1 = db.addFavorite(userId, trackA);
    expect(fav1.added).toBe(true);
    expect(db.isFavorite(userId, trackA.id)).toBe(true);

    const favDuplicate = db.addFavorite(userId, trackA);
    expect(favDuplicate.added).toBe(false);
    expect(db.getFavorites(userId)).toHaveLength(1);

    const toggledOff = db.toggleFavorite(userId, trackA);
    expect(toggledOff.favorited).toBe(false);
    expect(db.isFavorite(userId, trackA.id)).toBe(false);

    // 2. Playlists Pessoais e Faixas Guardadas
    const playlist = db.createPlaylist({
      userId,
      guildId,
      name: 'Noite Synthwave',
      description: 'Clássicos eletrónicos'
    });
    expect(playlist.name).toBe('Noite Synthwave');
    expect(playlist.trackCount).toBe(0);

    const item1 = db.addTrackToPlaylist(playlist.id, userId, trackA);
    const item2 = db.addTrackToPlaylist(playlist.id, userId, trackB);
    expect(item1.position).toBe(1);
    expect(item2.position).toBe(2);

    const fullPlaylist = db.getPlaylistById(playlist.id, userId);
    expect(fullPlaylist?.trackCount).toBe(2);
    expect(fullPlaylist?.tracks?.map((t) => t.title)).toEqual(['Veridis Quo', 'Midnight City']);

    // Remover a primeira faixa reordena automaticamente a segunda para position = 1
    db.removeTrackFromPlaylist(playlist.id, userId, item1.id);
    const afterRemove = db.getPlaylistById(playlist.id, userId);
    expect(afterRemove?.tracks).toHaveLength(1);
    expect(afterRemove?.tracks?.[0].title).toBe('Midnight City');
    expect(afterRemove?.tracks?.[0].position).toBe(1);

    // 3. Histórico de Reprodução
    db.addHistoryEntry(guildId, trackA);
    db.addHistoryEntry(guildId, trackB);
    const history = db.getHistory(guildId, 10);
    expect(history).toHaveLength(2);
    expect(history[0].title).toBe('Midnight City');
    expect(history[1].title).toBe('Veridis Quo');
    expect(history[1].requestedByName).toBe('Diogo');

    db.close();
  });

  it('persists playlists and favorites across application restarts and performs verified backup/restore', async () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, 'sonora.db');
    const backupDir = path.join(dir, 'backups');
    const userId = 'user-persist';
    const guildId = '111222333444555666';

    // Ciclo 1: Criar dados e fechar a base de dados (simulando reinício da aplicação)
    const db1 = new SonoraDatabase(dbPath, 'pt-PT');
    db1.addFavorite(userId, {
      id: 'yt-song1',
      title: 'Time',
      artist: 'Hans Zimmer',
      durationMs: 275_000,
      artworkUrl: null,
      source: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=song1'
    });
    const createdPlaylist = db1.createPlaylist({
      userId,
      guildId,
      name: 'Bandas Sonoras'
    });
    db1.addTrackToPlaylist(createdPlaylist.id, userId, {
      id: 'yt-song1',
      title: 'Time',
      artist: 'Hans Zimmer',
      durationMs: 275_000,
      artworkUrl: null,
      source: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=song1'
    });
    db1.close();

    // Ciclo 2: Reabrir a base de dados a partir do disco e confirmar persistência
    const db2 = new SonoraDatabase(dbPath, 'pt-PT');
    expect(db2.getFavorites(userId)).toHaveLength(1);
    expect(db2.getPlaylistsByUser(userId, guildId)).toHaveLength(1);
    expect(db2.getPlaylistById(createdPlaylist.id, userId)?.tracks).toHaveLength(1);

    // Criar cópia de segurança online (hot backup)
    const backupMeta = await createDatabaseBackup(db2, backupDir);
    expect(fs.existsSync(backupMeta.backupFilePath)).toBe(true);
    expect(backupMeta.sizeBytes).toBeGreaterThan(4096);

    // Eliminar a playlist na base de dados ativa
    db2.deletePlaylist(createdPlaylist.id, userId);
    expect(db2.getPlaylistsByUser(userId, guildId)).toHaveLength(0);
    db2.close();

    // Restaurar a partir da cópia de segurança e verificar recuperação dos dados
    const restoreRes = restoreDatabaseBackup(backupMeta.backupFilePath, dbPath);
    expect(restoreRes.preRestoreSnapshotPath).not.toBeNull();

    const db3 = new SonoraDatabase(dbPath, 'pt-PT');
    expect(db3.getPlaylistsByUser(userId, guildId)).toHaveLength(1);
    expect(db3.getPlaylistById(createdPlaylist.id, userId)?.name).toBe('Bandas Sonoras');
    db3.close();
  });
});
