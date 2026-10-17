import path from 'node:path';
import type { VoiceBasedChannel } from 'discord.js';
import {
  logger,
  type AppConfig,
  type LoopMode,
  type LyricsResult,
  type PlayerStateSnapshot,
  type SupportedLocale,
  type Track,
  type TrackRequester
} from '@sonora/shared';
import { SonoraDatabase } from '@sonora/database';
import { LyricsService, SonoraAudioEngine } from '@sonora/audio-engine';
import type { BotPlaybackPort, PlayCommandResult } from './command-router.js';

export class RealAudioPlaybackPort implements BotPlaybackPort {
  public readonly engine: SonoraAudioEngine;
  public readonly lyricsService: LyricsService;
  public readonly database: SonoraDatabase;
  private readonly initializedGuilds = new Set<string>();

  constructor(
    config: AppConfig,
    options?: {
      engine?: SonoraAudioEngine;
      lyricsService?: LyricsService;
      database?: SonoraDatabase;
    }
  ) {
    this.database =
      options?.database ??
      new SonoraDatabase(path.resolve(config.DATABASE_PATH), config.DEFAULT_LANGUAGE);

    this.engine =
      options?.engine ??
      new SonoraAudioEngine({
        defaultLocale: config.DEFAULT_LANGUAGE,
        allowInsecureDirectHttp: config.ALLOW_INSECURE_DIRECT_AUDIO_HTTP,
        ffmpegPath: config.FFMPEG_PATH,
        ytDlpPath: config.YTDLP_PATH,
        spotifyClientId: config.SPOTIFY_CLIENT_ID,
        spotifyClientSecret: config.SPOTIFY_CLIENT_SECRET
      });

    this.lyricsService =
      options?.lyricsService ??
      new LyricsService({
        lrclibBaseUrl: config.LRCLIB_API_URL,
        geniusAccessToken: config.GENIUS_ACCESS_TOKEN
      });

    // Regista automaticamente todas as faixas reproduzidas no histórico SQLite
    this.engine.on('trackStarted', ({ guildId, track }: { guildId: string; track: Track }) => {
      try {
        this.database.addHistoryEntry(guildId, track);
      } catch (err) {
        logger.warn({ err, guildId }, '[Sonora DB] Falha ao registar faixa no histórico SQLite');
      }
    });
  }

  private ensureGuildSyncedFromDb(guildId: string): void {
    if (this.initializedGuilds.has(guildId)) return;
    this.initializedGuilds.add(guildId);

    const settings = this.database.getGuildSettings(guildId);
    const djRoles = this.database.getDjRoles(guildId);
    this.engine.setGuildLocale(guildId, settings.language);
    this.engine.setVolume(guildId, settings.defaultVolume);
    this.engine.setGuildDjConfig(
      guildId,
      settings.djOnlyMode,
      djRoles.map((r) => r.roleId)
    );
  }

  public getState(guildId: string): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.getState(guildId);
  }

  public getGuildLocale(guildId: string): SupportedLocale {
    this.ensureGuildSyncedFromDb(guildId);
    return this.database.getGuildSettings(guildId).language;
  }

  public setGuildLocale(guildId: string, locale: SupportedLocale): void {
    this.ensureGuildSyncedFromDb(guildId);
    this.database.updateGuildSettings(guildId, { language: locale });
    this.engine.setGuildLocale(guildId, locale);
  }

  public hasDjPermission(
    guildId: string,
    member: { id: string; isAdmin: boolean; roleIds: string[]; voiceChannelUserCount?: number }
  ): boolean {
    this.ensureGuildSyncedFromDb(guildId);
    const settings = this.database.getGuildSettings(guildId);
    const djRoles = this.database.getDjRoles(guildId);
    this.engine.setGuildDjConfig(
      guildId,
      settings.djOnlyMode,
      djRoles.map((r) => r.roleId)
    );
    return this.engine.hasDjPermission(guildId, member);
  }

  public async play(params: {
    guildId: string;
    query: string;
    voiceChannel: VoiceBasedChannel;
    textChannelId: string;
    requester: TrackRequester;
  }): Promise<PlayCommandResult> {
    this.ensureGuildSyncedFromDb(params.guildId);
    return this.engine.play({
      guildId: params.guildId,
      query: params.query,
      voiceChannel: {
        id: params.voiceChannel.id,
        name: params.voiceChannel.name,
        guildId: params.voiceChannel.guild.id,
        adapterCreator: params.voiceChannel.guild.voiceAdapterCreator
      },
      textChannelId: params.textChannelId,
      requester: params.requester
    });
  }

  public pause(guildId: string): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.pause(guildId);
  }

  public resume(guildId: string): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.resume(guildId);
  }

  public skip(guildId: string): {
    skipped: Track | null;
    next: Track | null;
    state: PlayerStateSnapshot;
  } {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.skip(guildId);
  }

  public stop(guildId: string): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.stop(guildId);
  }

  public leave(guildId: string): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.leave(guildId);
  }

  public setVolume(guildId: string, volume: number): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    const nextState = this.engine.setVolume(guildId, volume);
    this.database.updateGuildSettings(guildId, { defaultVolume: nextState.volume });
    return nextState;
  }

  public removeTrack(
    guildId: string,
    positionOneBased: number
  ): { removed: Track; state: PlayerStateSnapshot } {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.removeTrack(guildId, positionOneBased);
  }

  public clearQueue(guildId: string): { clearedCount: number; state: PlayerStateSnapshot } {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.clearQueue(guildId);
  }

  public shuffleQueue(guildId: string): { shuffledCount: number; state: PlayerStateSnapshot } {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.shuffleQueue(guildId);
  }

  public setLoopMode(guildId: string, mode: LoopMode): PlayerStateSnapshot {
    this.ensureGuildSyncedFromDb(guildId);
    return this.engine.setLoopMode(guildId, mode);
  }

  public async getLyrics(guildId: string, query?: string): Promise<LyricsResult | null> {
    this.ensureGuildSyncedFromDb(guildId);
    const state = this.engine.getState(guildId);
    const searchTitle = query?.trim() || state.currentTrack?.title || '';
    const artistHint = query?.trim() ? '' : state.currentTrack?.artist ?? '';
    if (!searchTitle) return null;
    return this.lyricsService.searchLyrics(searchTitle, artistHint);
  }
}
