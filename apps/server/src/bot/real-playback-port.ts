import type { VoiceBasedChannel } from 'discord.js';
import type {
  AppConfig,
  LoopMode,
  LyricsResult,
  PlayerStateSnapshot,
  SupportedLocale,
  Track,
  TrackRequester
} from '@sonora/shared';
import { LyricsService, SonoraAudioEngine } from '@sonora/audio-engine';
import type { BotPlaybackPort, PlayCommandResult } from './command-router.js';

export class RealAudioPlaybackPort implements BotPlaybackPort {
  public readonly engine: SonoraAudioEngine;
  public readonly lyricsService: LyricsService;

  constructor(config: AppConfig, engine?: SonoraAudioEngine, lyricsService?: LyricsService) {
    this.engine =
      engine ??
      new SonoraAudioEngine({
        defaultLocale: config.DEFAULT_LANGUAGE,
        allowInsecureDirectHttp: config.ALLOW_INSECURE_DIRECT_AUDIO_HTTP,
        ffmpegPath: config.FFMPEG_PATH,
        ytDlpPath: config.YTDLP_PATH
      });

    this.lyricsService =
      lyricsService ??
      new LyricsService({
        lrclibBaseUrl: config.LRCLIB_API_URL,
        geniusAccessToken: config.GENIUS_ACCESS_TOKEN
      });
  }

  public getState(guildId: string): PlayerStateSnapshot {
    return this.engine.getState(guildId);
  }

  public getGuildLocale(guildId: string): SupportedLocale {
    return this.engine.getGuildLocale(guildId);
  }

  public setGuildLocale(guildId: string, locale: SupportedLocale): void {
    this.engine.setGuildLocale(guildId, locale);
  }

  public hasDjPermission(
    guildId: string,
    member: { id: string; isAdmin: boolean; roleIds: string[]; voiceChannelUserCount?: number }
  ): boolean {
    return this.engine.hasDjPermission(guildId, member);
  }

  public async play(params: {
    guildId: string;
    query: string;
    voiceChannel: VoiceBasedChannel;
    textChannelId: string;
    requester: TrackRequester;
  }): Promise<PlayCommandResult> {
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
    return this.engine.pause(guildId);
  }

  public resume(guildId: string): PlayerStateSnapshot {
    return this.engine.resume(guildId);
  }

  public skip(guildId: string): {
    skipped: Track | null;
    next: Track | null;
    state: PlayerStateSnapshot;
  } {
    return this.engine.skip(guildId);
  }

  public stop(guildId: string): PlayerStateSnapshot {
    return this.engine.stop(guildId);
  }

  public leave(guildId: string): PlayerStateSnapshot {
    return this.engine.leave(guildId);
  }

  public setVolume(guildId: string, volume: number): PlayerStateSnapshot {
    return this.engine.setVolume(guildId, volume);
  }

  public removeTrack(
    guildId: string,
    positionOneBased: number
  ): { removed: Track; state: PlayerStateSnapshot } {
    return this.engine.removeTrack(guildId, positionOneBased);
  }

  public clearQueue(guildId: string): { clearedCount: number; state: PlayerStateSnapshot } {
    return this.engine.clearQueue(guildId);
  }

  public shuffleQueue(guildId: string): { shuffledCount: number; state: PlayerStateSnapshot } {
    return this.engine.shuffleQueue(guildId);
  }

  public setLoopMode(guildId: string, mode: LoopMode): PlayerStateSnapshot {
    return this.engine.setLoopMode(guildId, mode);
  }

  public async getLyrics(guildId: string, query?: string): Promise<LyricsResult | null> {
    const state = this.engine.getState(guildId);
    const searchTitle = query?.trim() || state.currentTrack?.title || '';
    const artistHint = query?.trim() ? '' : state.currentTrack?.artist ?? '';
    if (!searchTitle) return null;
    return this.lyricsService.searchLyrics(searchTitle, artistHint);
  }
}
