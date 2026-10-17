import { EventEmitter } from 'node:events';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type AudioResource,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection
} from '@discordjs/voice';
import {
  logger,
  type LoopMode,
  type PlayerStateSnapshot,
  type SupportedLocale,
  type Track,
  type TrackRequester
} from '@sonora/shared';
import type { AudioSourceAdapter, PcmAudioStreamHandle } from './adapters/types.js';
import { DirectAudioAdapter } from './adapters/direct-audio-adapter.js';
import { SoundCloudAdapter } from './adapters/soundcloud-adapter.js';
import { SpotifyMetadataAdapter } from './adapters/spotify-adapter.js';
import { YouTubeAdapter } from './adapters/youtube-adapter.js';

export interface VoiceChannelTarget {
  id: string;
  name: string;
  guildId: string;
  adapterCreator?: DiscordGatewayAdapterCreator;
}

export interface SonoraAudioEngineOptions {
  defaultLocale?: SupportedLocale;
  defaultVolume?: number;
  allowInsecureDirectHttp?: boolean;
  ffmpegPath?: string;
  ytDlpPath?: string;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  adapters?: AudioSourceAdapter[];
  connectToVoiceFn?: (target: VoiceChannelTarget) => Promise<VoiceConnection | null>;
}

interface GuildAudioSession {
  state: PlayerStateSnapshot;
  connection: VoiceConnection | null;
  player: AudioPlayer;
  currentResource: AudioResource<Track> | null;
  currentStreamHandle: PcmAudioStreamHandle | null;
  startedPlayingAtMs: number | null;
  accumulatedPlayedMs: number;
  suppressNextIdleTransition: boolean;
}

export class SonoraAudioEngine extends EventEmitter {
  private readonly sessions = new Map<string, GuildAudioSession>();
  private readonly locales = new Map<string, SupportedLocale>();
  private readonly djRoleIdsByGuild = new Map<string, Set<string>>();
  private readonly djOnlyModeByGuild = new Map<string, boolean>();
  private readonly adapters: AudioSourceAdapter[];
  private readonly defaultLocale: SupportedLocale;
  private readonly defaultVolume: number;
  private readonly connectToVoiceFn?: (target: VoiceChannelTarget) => Promise<VoiceConnection | null>;

  constructor(options: SonoraAudioEngineOptions = {}) {
    super();
    this.defaultLocale = options.defaultLocale ?? 'pt-PT';
    this.defaultVolume = options.defaultVolume ?? 80;
    this.connectToVoiceFn = options.connectToVoiceFn;

    const youtubeAdapter = new YouTubeAdapter({
      ffmpegPath: options.ffmpegPath,
      ytDlpPath: options.ytDlpPath
    });

    this.adapters = options.adapters ?? [
      new DirectAudioAdapter({
        allowHttp: options.allowInsecureDirectHttp ?? false,
        ffmpegPath: options.ffmpegPath
      }),
      new SoundCloudAdapter({
        ffmpegPath: options.ffmpegPath,
        ytDlpPath: options.ytDlpPath
      }),
      new SpotifyMetadataAdapter({
        clientId: options.spotifyClientId,
        clientSecret: options.spotifyClientSecret,
        fallbackSearchAdapter: youtubeAdapter
      }),
      youtubeAdapter
    ];
  }

  public getGuildLocale(guildId: string): SupportedLocale {
    return this.locales.get(guildId) ?? this.defaultLocale;
  }

  public setGuildLocale(guildId: string, locale: SupportedLocale): void {
    this.locales.set(guildId, locale);
    this.emit('localeChanged', { guildId, locale });
  }

  public setGuildDjConfig(guildId: string, djOnlyMode: boolean, roleIds: string[]): void {
    this.djOnlyModeByGuild.set(guildId, djOnlyMode);
    this.djRoleIdsByGuild.set(guildId, new Set(roleIds));
  }

  public hasDjPermission(
    guildId: string,
    member: { id: string; isAdmin: boolean; roleIds: string[]; voiceChannelUserCount?: number }
  ): boolean {
    if (member.isAdmin) return true;
    // Se o utilizador estiver sozinho no canal de voz com o bot, pode controlar livremente
    if (member.voiceChannelUserCount !== undefined && member.voiceChannelUserCount <= 1) {
      return true;
    }
    const djOnly = this.djOnlyModeByGuild.get(guildId) ?? false;
    const configuredRoles = this.djRoleIdsByGuild.get(guildId);
    if (!djOnly && (!configuredRoles || configuredRoles.size === 0)) {
      return true;
    }
    if (!configuredRoles || configuredRoles.size === 0) {
      return !djOnly;
    }
    return member.roleIds.some((roleId) => configuredRoles.has(roleId));
  }

  private getOrCreateSession(guildId: string): GuildAudioSession {
    let session = this.sessions.get(guildId);
    if (session) return session;

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });

    const initialState: PlayerStateSnapshot = {
      guildId,
      voiceChannelId: null,
      voiceChannelName: null,
      textChannelId: null,
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: this.defaultVolume,
      loopMode: 'off',
      shuffled: false,
      positionMs: 0,
      lastError: null,
      botConnected: false,
      updatedAt: new Date().toISOString()
    };

    session = {
      state: initialState,
      connection: null,
      player,
      currentResource: null,
      currentStreamHandle: null,
      startedPlayingAtMs: null,
      accumulatedPlayedMs: 0,
      suppressNextIdleTransition: false
    };

    player.on(AudioPlayerStatus.Playing, () => {
      if (!session) return;
      session.state.status = 'playing';
      session.startedPlayingAtMs = Date.now();
      this.notifyStateChanged(session);
    });

    player.on(AudioPlayerStatus.Paused, () => {
      if (!session) return;
      if (session.startedPlayingAtMs !== null) {
        session.accumulatedPlayedMs += Date.now() - session.startedPlayingAtMs;
        session.startedPlayingAtMs = null;
      }
      session.state.status = 'paused';
      this.notifyStateChanged(session);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      if (!session) return;
      if (session.suppressNextIdleTransition) {
        session.suppressNextIdleTransition = false;
        return;
      }
      void this.handleTrackFinished(session);
    });

    player.on('error', (err) => {
      if (!session) return;
      logger.error({ err, guildId }, '[Sonora Audio] Erro no AudioPlayer');
      session.state.lastError = err.message;
      session.state.status = 'error';
      this.notifyStateChanged(session);
      void this.handleTrackFinished(session);
    });

    this.sessions.set(guildId, session);
    return session;
  }

  private notifyStateChanged(session: GuildAudioSession): void {
    session.state.positionMs = this.computePositionMs(session);
    session.state.updatedAt = new Date().toISOString();
    this.emit('stateChanged', this.cloneState(session.state));
  }

  private computePositionMs(session: GuildAudioSession): number {
    if (!session.state.currentTrack) return 0;
    let total = session.accumulatedPlayedMs;
    if (session.state.status === 'playing' && session.startedPlayingAtMs !== null) {
      total += Date.now() - session.startedPlayingAtMs;
    }
    return Math.max(0, total);
  }

  private cloneState(state: PlayerStateSnapshot): PlayerStateSnapshot {
    return {
      ...state,
      currentTrack: state.currentTrack ? { ...state.currentTrack } : null,
      queue: state.queue.map((t) => ({ ...t }))
    };
  }

  public getState(guildId: string): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    session.state.positionMs = this.computePositionMs(session);
    return this.cloneState(session.state);
  }

  public findAdapter(queryOrUrl: string): AudioSourceAdapter {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(queryOrUrl)) {
        return adapter;
      }
    }
    throw new Error('Nenhuma fonte de áudio compatível encontrada para o pedido.');
  }

  public findAdapterBySource(source: Track['source']): AudioSourceAdapter {
    const adapter = this.adapters.find((a) => a.sourceType === source);
    if (!adapter) {
      throw new Error(`Adaptador de áudio não disponível para a fonte: ${source}`);
    }
    return adapter;
  }

  public async resolveTrack(queryOrUrl: string, requester: TrackRequester | null): Promise<Track> {
    const adapter = this.findAdapter(queryOrUrl);
    return adapter.resolveTrack(queryOrUrl, requester);
  }

  private async ensureVoiceConnection(
    session: GuildAudioSession,
    target: VoiceChannelTarget
  ): Promise<void> {
    const alreadyInTargetChannel =
      session.connection &&
      session.state.botConnected &&
      session.state.voiceChannelId === target.id &&
      session.connection.state.status !== VoiceConnectionStatus.Destroyed;

    if (alreadyInTargetChannel) {
      return;
    }

    if (this.connectToVoiceFn) {
      const customConn = await this.connectToVoiceFn(target);
      session.connection = customConn;
      session.state.voiceChannelId = target.id;
      session.state.voiceChannelName = target.name;
      session.state.botConnected = true;
      return;
    }

    if (!target.adapterCreator) {
      throw new Error('voiceAdapterCreator não disponível no servidor Discord.');
    }

    const connection = joinVoiceChannel({
      channelId: target.id,
      guildId: target.guildId,
      adapterCreator: target.adapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }
        session.connection = null;
        session.state.botConnected = false;
        session.state.voiceChannelId = null;
        session.state.voiceChannelName = null;
        this.notifyStateChanged(session);
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    connection.subscribe(session.player);

    session.connection = connection;
    session.state.voiceChannelId = target.id;
    session.state.voiceChannelName = target.name;
    session.state.botConnected = true;
  }

  private cleanupCurrentStream(session: GuildAudioSession): void {
    if (session.currentStreamHandle) {
      try {
        session.currentStreamHandle.cleanup();
      } catch {
        // Ignorado
      }
      session.currentStreamHandle = null;
    }
    session.currentResource = null;
  }

  private async startPlayingTrack(session: GuildAudioSession, track: Track): Promise<void> {
    this.cleanupCurrentStream(session);

    session.state.currentTrack = track;
    session.state.status = 'buffering';
    session.state.lastError = null;
    session.accumulatedPlayedMs = 0;
    session.startedPlayingAtMs = null;
    this.notifyStateChanged(session);

    const adapter = this.findAdapterBySource(track.source);
    const streamHandle = await adapter.createPcmStream(track);
    session.currentStreamHandle = streamHandle;

    const resource = createAudioResource(streamHandle.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track
    });

    resource.volume?.setVolume(session.state.volume / 100);
    session.currentResource = resource;
    session.startedPlayingAtMs = Date.now();
    session.state.status = 'playing';

    session.player.play(resource);
    this.emit('trackStarted', {
      guildId: session.state.guildId,
      track,
      state: this.getState(session.state.guildId)
    });
    this.notifyStateChanged(session);
  }

  private async handleTrackFinished(session: GuildAudioSession): Promise<void> {
    const finishedTrack = session.state.currentTrack;
    this.cleanupCurrentStream(session);

    if (finishedTrack) {
      this.emit('trackEnded', {
        guildId: session.state.guildId,
        track: finishedTrack
      });
    }

    let nextTrack: Track | null = null;
    if (session.state.loopMode === 'track' && finishedTrack) {
      nextTrack = finishedTrack;
    } else {
      if (session.state.loopMode === 'queue' && finishedTrack) {
        session.state.queue.push(finishedTrack);
      }
      nextTrack = session.state.queue.shift() ?? null;
    }

    if (!nextTrack) {
      session.state.currentTrack = null;
      session.state.status = 'idle';
      session.accumulatedPlayedMs = 0;
      session.startedPlayingAtMs = null;
      this.notifyStateChanged(session);
      return;
    }

    try {
      await this.startPlayingTrack(session, nextTrack);
    } catch (err) {
      logger.error({ err, track: nextTrack.title }, '[Sonora Audio] Falha ao iniciar faixa seguinte');
      session.state.lastError = err instanceof Error ? err.message : String(err);
      session.state.currentTrack = null;
      session.state.status = 'idle';
      this.notifyStateChanged(session);
    }
  }

  public async play(params: {
    guildId: string;
    query: string;
    voiceChannel: VoiceChannelTarget;
    textChannelId: string;
    requester: TrackRequester;
  }): Promise<{ track: Track; startedImmediately: boolean; state: PlayerStateSnapshot }> {
    const session = this.getOrCreateSession(params.guildId);
    session.state.textChannelId = params.textChannelId;

    await this.ensureVoiceConnection(session, params.voiceChannel);
    const track = await this.resolveTrack(params.query, params.requester);

    const startedImmediately = !session.state.currentTrack;
    if (startedImmediately) {
      await this.startPlayingTrack(session, track);
    } else {
      session.state.queue.push(track);
      this.notifyStateChanged(session);
    }

    return {
      track,
      startedImmediately,
      state: this.getState(params.guildId)
    };
  }

  public pause(guildId: string): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    if (session.state.currentTrack && session.state.status === 'playing') {
      session.player.pause(true);
      if (session.startedPlayingAtMs !== null) {
        session.accumulatedPlayedMs += Date.now() - session.startedPlayingAtMs;
        session.startedPlayingAtMs = null;
      }
      session.state.status = 'paused';
      this.notifyStateChanged(session);
    }
    return this.getState(guildId);
  }

  public resume(guildId: string): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    if (session.state.currentTrack && session.state.status === 'paused') {
      session.player.unpause();
      session.startedPlayingAtMs = Date.now();
      session.state.status = 'playing';
      this.notifyStateChanged(session);
    }
    return this.getState(guildId);
  }

  public skip(guildId: string): {
    skipped: Track | null;
    next: Track | null;
    state: PlayerStateSnapshot;
  } {
    const session = this.getOrCreateSession(guildId);
    const skipped = session.state.currentTrack;

    if (session.state.loopMode === 'queue' && skipped) {
      session.state.queue.push(skipped);
    }

    const next = session.state.queue.shift() ?? null;
    session.suppressNextIdleTransition = true;
    session.player.stop(true);
    this.cleanupCurrentStream(session);

    if (next) {
      void this.startPlayingTrack(session, next).catch((err) => {
        logger.error({ err }, '[Sonora Audio] Erro ao reproduzir faixa após skip');
      });
      session.state.currentTrack = next;
      session.state.status = 'playing';
    } else {
      session.state.currentTrack = null;
      session.state.status = 'idle';
      session.accumulatedPlayedMs = 0;
      session.startedPlayingAtMs = null;
      this.notifyStateChanged(session);
    }

    return {
      skipped,
      next,
      state: this.getState(guildId)
    };
  }

  public stop(guildId: string): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    session.state.queue = [];
    session.state.currentTrack = null;
    session.state.status = 'idle';
    session.accumulatedPlayedMs = 0;
    session.startedPlayingAtMs = null;
    session.suppressNextIdleTransition = true;
    session.player.stop(true);
    this.cleanupCurrentStream(session);
    this.notifyStateChanged(session);
    return this.getState(guildId);
  }

  public leave(guildId: string): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    this.stop(guildId);
    if (session.connection) {
      try {
        if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          session.connection.destroy();
        }
      } catch {
        // Ignorado
      }
      session.connection = null;
    }
    session.state.botConnected = false;
    session.state.voiceChannelId = null;
    session.state.voiceChannelName = null;
    this.notifyStateChanged(session);
    return this.getState(guildId);
  }

  public setVolume(guildId: string, volume: number): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    session.state.volume = clamped;
    if (session.currentResource?.volume) {
      session.currentResource.volume.setVolume(clamped / 100);
    }
    this.notifyStateChanged(session);
    return this.getState(guildId);
  }

  public removeTrack(
    guildId: string,
    positionOneBased: number
  ): { removed: Track; state: PlayerStateSnapshot } {
    const session = this.getOrCreateSession(guildId);
    const idx = positionOneBased - 1;
    if (idx < 0 || idx >= session.state.queue.length) {
      throw new RangeError('INVALID_QUEUE_POSITION');
    }
    const [removed] = session.state.queue.splice(idx, 1);
    this.notifyStateChanged(session);
    return {
      removed,
      state: this.getState(guildId)
    };
  }

  public clearQueue(guildId: string): { clearedCount: number; state: PlayerStateSnapshot } {
    const session = this.getOrCreateSession(guildId);
    const clearedCount = session.state.queue.length;
    session.state.queue = [];
    session.state.shuffled = false;
    this.notifyStateChanged(session);
    return {
      clearedCount,
      state: this.getState(guildId)
    };
  }

  public shuffleQueue(guildId: string): { shuffledCount: number; state: PlayerStateSnapshot } {
    const session = this.getOrCreateSession(guildId);
    for (let i = session.state.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [session.state.queue[i], session.state.queue[j]] = [
        session.state.queue[j],
        session.state.queue[i]
      ];
    }
    session.state.shuffled = session.state.queue.length > 0;
    this.notifyStateChanged(session);
    return {
      shuffledCount: session.state.queue.length,
      state: this.getState(guildId)
    };
  }

  public setLoopMode(guildId: string, mode: LoopMode): PlayerStateSnapshot {
    const session = this.getOrCreateSession(guildId);
    session.state.loopMode = mode;
    this.notifyStateChanged(session);
    return this.getState(guildId);
  }
}
