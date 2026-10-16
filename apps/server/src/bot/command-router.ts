import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel
} from 'discord.js';
import {
  t,
  type LoopMode,
  type LyricsResult,
  type PlayerStateSnapshot,
  type SupportedLocale,
  type Track,
  type TrackRequester
} from '@sonora/shared';
import {
  createSonoraHelpEmbed,
  createSonoraQueueEmbed,
  createSonoraStatusEmbed
} from './embeds.js';

export interface PlayCommandResult {
  track: Track;
  startedImmediately: boolean;
  state: PlayerStateSnapshot;
}

export interface BotPlaybackPort {
  getState(guildId: string): PlayerStateSnapshot;
  getGuildLocale(guildId: string): SupportedLocale;
  setGuildLocale(guildId: string, locale: SupportedLocale): void;
  hasDjPermission(guildId: string, member: { id: string; isAdmin: boolean; roleIds: string[]; voiceChannelUserCount?: number }): boolean;
  play(params: {
    guildId: string;
    query: string;
    voiceChannel: VoiceBasedChannel;
    textChannelId: string;
    requester: TrackRequester;
  }): Promise<PlayCommandResult>;
  pause(guildId: string): PlayerStateSnapshot;
  resume(guildId: string): PlayerStateSnapshot;
  skip(guildId: string): { skipped: Track | null; next: Track | null; state: PlayerStateSnapshot };
  stop(guildId: string): PlayerStateSnapshot;
  leave(guildId: string): PlayerStateSnapshot;
  setVolume(guildId: string, volume: number): PlayerStateSnapshot;
  removeTrack(guildId: string, positionOneBased: number): { removed: Track; state: PlayerStateSnapshot };
  clearQueue(guildId: string): { clearedCount: number; state: PlayerStateSnapshot };
  shuffleQueue(guildId: string): { shuffledCount: number; state: PlayerStateSnapshot };
  setLoopMode(guildId: string, mode: LoopMode): PlayerStateSnapshot;
  getLyrics(guildId: string, query?: string): Promise<LyricsResult | null>;
}

export class InMemoryFallbackPlaybackPort implements BotPlaybackPort {
  private readonly states = new Map<string, PlayerStateSnapshot>();
  private readonly locales = new Map<string, SupportedLocale>();
  private readonly defaultLocale: SupportedLocale;

  constructor(defaultLocale: SupportedLocale = 'pt-PT') {
    this.defaultLocale = defaultLocale;
  }

  public getGuildLocale(guildId: string): SupportedLocale {
    return this.locales.get(guildId) ?? this.defaultLocale;
  }

  public setGuildLocale(guildId: string, locale: SupportedLocale): void {
    this.locales.set(guildId, locale);
  }

  public hasDjPermission(): boolean {
    return true;
  }

  public getState(guildId: string): PlayerStateSnapshot {
    let state = this.states.get(guildId);
    if (!state) {
      state = {
        guildId,
        voiceChannelId: null,
        voiceChannelName: null,
        textChannelId: null,
        status: 'idle',
        currentTrack: null,
        queue: [],
        volume: 80,
        loopMode: 'off',
        shuffled: false,
        positionMs: 0,
        lastError: null,
        botConnected: false,
        updatedAt: new Date().toISOString()
      };
      this.states.set(guildId, state);
    }
    return state;
  }

  public async play(params: {
    guildId: string;
    query: string;
    voiceChannel: VoiceBasedChannel;
    textChannelId: string;
    requester: TrackRequester;
  }): Promise<PlayCommandResult> {
    const state = this.getState(params.guildId);
    state.voiceChannelId = params.voiceChannel.id;
    state.voiceChannelName = params.voiceChannel.name;
    state.textChannelId = params.textChannelId;
    state.botConnected = true;

    const track: Track = {
      id: `track-${Date.now()}`,
      title: params.query.trim(),
      artist: 'Sonora Audio',
      durationMs: 180_000,
      artworkUrl: null,
      source: 'youtube',
      sourceUrl: params.query.startsWith('http') ? params.query : `https://www.youtube.com/results?search_query=${encodeURIComponent(params.query)}`,
      requestedBy: params.requester,
      addedAt: new Date().toISOString()
    };

    const startedImmediately = !state.currentTrack;
    if (startedImmediately) {
      state.currentTrack = track;
      state.status = 'playing';
      state.positionMs = 0;
    } else {
      state.queue.push(track);
    }
    state.updatedAt = new Date().toISOString();
    return { track, startedImmediately, state };
  }

  public pause(guildId: string): PlayerStateSnapshot {
    const state = this.getState(guildId);
    if (state.currentTrack && state.status === 'playing') {
      state.status = 'paused';
      state.updatedAt = new Date().toISOString();
    }
    return state;
  }

  public resume(guildId: string): PlayerStateSnapshot {
    const state = this.getState(guildId);
    if (state.currentTrack && state.status === 'paused') {
      state.status = 'playing';
      state.updatedAt = new Date().toISOString();
    }
    return state;
  }

  public skip(guildId: string): { skipped: Track | null; next: Track | null; state: PlayerStateSnapshot } {
    const state = this.getState(guildId);
    const skipped = state.currentTrack;
    const next = state.queue.shift() ?? null;
    state.currentTrack = next;
    state.status = next ? 'playing' : 'idle';
    state.positionMs = 0;
    state.updatedAt = new Date().toISOString();
    return { skipped, next, state };
  }

  public stop(guildId: string): PlayerStateSnapshot {
    const state = this.getState(guildId);
    state.currentTrack = null;
    state.queue = [];
    state.status = 'idle';
    state.positionMs = 0;
    state.updatedAt = new Date().toISOString();
    return state;
  }

  public leave(guildId: string): PlayerStateSnapshot {
    const state = this.stop(guildId);
    state.voiceChannelId = null;
    state.voiceChannelName = null;
    state.botConnected = false;
    state.updatedAt = new Date().toISOString();
    return state;
  }

  public setVolume(guildId: string, volume: number): PlayerStateSnapshot {
    const state = this.getState(guildId);
    state.volume = Math.max(0, Math.min(200, Math.round(volume)));
    state.updatedAt = new Date().toISOString();
    return state;
  }

  public removeTrack(guildId: string, positionOneBased: number): { removed: Track; state: PlayerStateSnapshot } {
    const state = this.getState(guildId);
    const idx = positionOneBased - 1;
    if (idx < 0 || idx >= state.queue.length) {
      throw new RangeError('INVALID_QUEUE_POSITION');
    }
    const [removed] = state.queue.splice(idx, 1);
    state.updatedAt = new Date().toISOString();
    return { removed, state };
  }

  public clearQueue(guildId: string): { clearedCount: number; state: PlayerStateSnapshot } {
    const state = this.getState(guildId);
    const clearedCount = state.queue.length;
    state.queue = [];
    state.updatedAt = new Date().toISOString();
    return { clearedCount, state };
  }

  public shuffleQueue(guildId: string): { shuffledCount: number; state: PlayerStateSnapshot } {
    const state = this.getState(guildId);
    for (let i = state.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
    }
    state.shuffled = state.queue.length > 1;
    state.updatedAt = new Date().toISOString();
    return { shuffledCount: state.queue.length, state };
  }

  public setLoopMode(guildId: string, mode: LoopMode): PlayerStateSnapshot {
    const state = this.getState(guildId);
    state.loopMode = mode;
    state.updatedAt = new Date().toISOString();
    return state;
  }

  public async getLyrics(guildId: string, query?: string): Promise<LyricsResult | null> {
    const state = this.getState(guildId);
    const targetTitle = query?.trim() || state.currentTrack?.title;
    if (!targetTitle) return null;
    return {
      trackTitle: targetTitle,
      artistName: state.currentTrack?.artist ?? '',
      provider: 'none',
      plainLyrics: null,
      syncedLyrics: null,
      externalUrl: `https://lrclib.net/search?q=${encodeURIComponent(targetTitle)}`,
      isTruncated: false,
      copyrightNotice: 'LRCLIB'
    };
  }
}

export class SonoraCommandRouter {
  private readonly playback: BotPlaybackPort;

  constructor(playback: BotPlaybackPort) {
    this.playback = playback;
  }

  private extractMemberContext(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember | null;
    const isAdmin = Boolean(
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    );
    const roleIds = member?.roles?.cache ? Array.from(member.roles.cache.keys()) : [];
    const voiceChannel = member?.voice?.channel ?? null;
    const nonBotMembersCount = voiceChannel
      ? voiceChannel.members.filter((m) => !m.user.bot).size
      : 0;

    return {
      member,
      isAdmin,
      roleIds,
      voiceChannel,
      voiceChannelUserCount: nonBotMembersCount
    };
  }

  private ensureVoicePreconditions(
    interaction: ChatInputCommandInteraction,
    locale: SupportedLocale,
    requireBotInSameChannel = true
  ): VoiceBasedChannel | null {
    const { voiceChannel } = this.extractMemberContext(interaction);
    if (!voiceChannel) {
      return null;
    }

    if (requireBotInSameChannel && interaction.guildId) {
      const state = this.playback.getState(interaction.guildId);
      if (state.voiceChannelId && state.voiceChannelId !== voiceChannel.id) {
        throw new Error(
          t(locale, 'common.error.sameVoiceRequired', {
            channel: state.voiceChannelName ?? state.voiceChannelId
          })
        );
      }
    }

    return voiceChannel;
  }

  public async handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        embeds: [createSonoraStatusEmbed(t('pt-PT', 'common.error.guildOnly'), 'error')],
        ephemeral: true
      });
      return;
    }

    const locale = this.playback.getGuildLocale(guildId);
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'help': {
          await interaction.reply({
            embeds: [createSonoraHelpEmbed(locale)]
          });
          return;
        }

        case 'language': {
          const { isAdmin } = this.extractMemberContext(interaction);
          if (!isAdmin) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.adminRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const targetLocale = interaction.options.getString('locale', true) as SupportedLocale;
          this.playback.setGuildLocale(guildId, targetLocale);
          await interaction.reply({
            embeds: [createSonoraStatusEmbed(t(targetLocale, 'language.changed'), 'accent')]
          });
          return;
        }

        case 'play': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }

          const query = interaction.options.getString('query', true).trim();
          if (!query) {
            await interaction.reply({
              embeds: [
                createSonoraStatusEmbed(
                  t(locale, 'common.error.invalidArgs', { details: 'query' }),
                  'error'
                )
              ],
              ephemeral: true
            });
            return;
          }

          await interaction.deferReply();
          const requester: TrackRequester = {
            id: interaction.user.id,
            username: interaction.user.username,
            displayName: interaction.user.displayName ?? interaction.user.username,
            avatarUrl: interaction.user.displayAvatarURL()
          };

          const result = await this.playback.play({
            guildId,
            query,
            voiceChannel,
            textChannelId: interaction.channelId,
            requester
          });

          const messageKey = result.startedImmediately ? 'player.nowPlaying' : 'player.trackAdded';
          await interaction.editReply({
            embeds: [
              createSonoraStatusEmbed(
                t(locale, messageKey, {
                  title: result.track.title,
                  artist: result.track.artist
                }),
                'accent'
              )
            ]
          });
          return;
        }

        case 'pause': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const state = this.playback.getState(guildId);
          if (!state.currentTrack) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.nothingPlaying'), 'warning')],
              ephemeral: true
            });
            return;
          }
          if (state.status === 'paused') {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'player.alreadyPaused'), 'warning')],
              ephemeral: true
            });
            return;
          }
          this.playback.pause(guildId);
          await interaction.reply({
            embeds: [createSonoraStatusEmbed(t(locale, 'player.paused'), 'accent')]
          });
          return;
        }

        case 'resume': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const state = this.playback.getState(guildId);
          if (!state.currentTrack) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.nothingPlaying'), 'warning')],
              ephemeral: true
            });
            return;
          }
          if (state.status === 'playing') {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'player.alreadyPlaying'), 'warning')],
              ephemeral: true
            });
            return;
          }
          this.playback.resume(guildId);
          await interaction.reply({
            embeds: [createSonoraStatusEmbed(t(locale, 'player.resumed'), 'accent')]
          });
          return;
        }

        case 'skip': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const state = this.playback.getState(guildId);
          if (!state.currentTrack) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.nothingPlaying'), 'warning')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          const isRequester = state.currentTrack.requestedBy?.id === interaction.user.id;
          if (!isRequester && !this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const { next } = this.playback.skip(guildId);
          const description = next
            ? t(locale, 'player.skipped', { title: next.title })
            : t(locale, 'player.skippedLast');
          await interaction.reply({
            embeds: [createSonoraStatusEmbed(description, 'accent')]
          });
          return;
        }

        case 'stop': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          if (!this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          this.playback.stop(guildId);
          await interaction.reply({
            embeds: [createSonoraStatusEmbed(t(locale, 'player.stopped'), 'accent')]
          });
          return;
        }

        case 'leave': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          if (!this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          this.playback.leave(guildId);
          await interaction.reply({
            embeds: [createSonoraStatusEmbed(t(locale, 'player.leftVoice'), 'accent')]
          });
          return;
        }

        case 'volume': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          if (!this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const level = interaction.options.getInteger('level', true);
          if (level < 0 || level > 200) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'player.volumeInvalid'), 'error')],
              ephemeral: true
            });
            return;
          }
          const nextState = this.playback.setVolume(guildId, level);
          await interaction.reply({
            embeds: [
              createSonoraStatusEmbed(
                t(locale, 'player.volumeChanged', { volume: nextState.volume }),
                'accent'
              )
            ]
          });
          return;
        }

        case 'nowplaying': {
          const state = this.playback.getState(guildId);
          if (!state.currentTrack) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.nothingPlaying'), 'idle')],
              ephemeral: true
            });
            return;
          }
          await interaction.reply({
            embeds: [
              createSonoraStatusEmbed(
                t(locale, 'player.nowPlaying', {
                  title: state.currentTrack.title,
                  artist: state.currentTrack.artist
                }),
                'accent'
              )
            ]
          });
          return;
        }

        case 'queue': {
          const page = interaction.options.getInteger('page', false) ?? 1;
          const state = this.playback.getState(guildId);
          await interaction.reply({
            embeds: [createSonoraQueueEmbed(state, page, locale)]
          });
          return;
        }

        case 'remove': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const state = this.playback.getState(guildId);
          if (state.queue.length === 0) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.emptyQueue'), 'warning')],
              ephemeral: true
            });
            return;
          }
          const position = interaction.options.getInteger('position', true);
          if (position < 1 || position > state.queue.length) {
            await interaction.reply({
              embeds: [
                createSonoraStatusEmbed(
                  t(locale, 'player.removeInvalidPosition', { max: state.queue.length }),
                  'error'
                )
              ],
              ephemeral: true
            });
            return;
          }

          const targetTrack = state.queue[position - 1];
          const memberCtx = this.extractMemberContext(interaction);
          const isRequester = targetTrack?.requestedBy?.id === interaction.user.id;
          if (!isRequester && !this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }

          const { removed } = this.playback.removeTrack(guildId, position);
          await interaction.reply({
            embeds: [
              createSonoraStatusEmbed(
                t(locale, 'player.removedTrack', {
                  position,
                  title: removed.title
                }),
                'accent'
              )
            ]
          });
          return;
        }

        case 'clear': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          if (!this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const { clearedCount } = this.playback.clearQueue(guildId);
          await interaction.reply({
            embeds: [
              createSonoraStatusEmbed(
                t(locale, 'player.queueCleared', { count: clearedCount }),
                'accent'
              )
            ]
          });
          return;
        }

        case 'shuffle': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          if (!this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const state = this.playback.getState(guildId);
          if (state.queue.length === 0) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.emptyQueue'), 'warning')],
              ephemeral: true
            });
            return;
          }
          const { shuffledCount } = this.playback.shuffleQueue(guildId);
          await interaction.reply({
            embeds: [
              createSonoraStatusEmbed(
                t(locale, 'player.shuffled', { count: shuffledCount }),
                'accent'
              )
            ]
          });
          return;
        }

        case 'loop': {
          const voiceChannel = this.ensureVoicePreconditions(interaction, locale, true);
          if (!voiceChannel) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.voiceRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const memberCtx = this.extractMemberContext(interaction);
          if (!this.playback.hasDjPermission(guildId, { id: interaction.user.id, ...memberCtx })) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.djRequired'), 'error')],
              ephemeral: true
            });
            return;
          }
          const mode = interaction.options.getString('mode', true) as LoopMode;
          this.playback.setLoopMode(guildId, mode);
          await interaction.reply({
            embeds: [
              createSonoraStatusEmbed(t(locale, `player.loopChanged.${mode}`), 'accent')
            ]
          });
          return;
        }

        case 'lyrics': {
          const query = interaction.options.getString('query', false) ?? undefined;
          const state = this.playback.getState(guildId);
          if (!query && !state.currentTrack) {
            await interaction.reply({
              embeds: [createSonoraStatusEmbed(t(locale, 'common.error.nothingPlaying'), 'warning')],
              ephemeral: true
            });
            return;
          }

          await interaction.deferReply();
          const lyrics = await this.playback.getLyrics(guildId, query);
          if (!lyrics || (!lyrics.plainLyrics && !lyrics.externalUrl)) {
            await interaction.editReply({
              embeds: [
                createSonoraStatusEmbed(
                  t(locale, 'lyrics.notFound', {
                    title: query ?? state.currentTrack?.title ?? '---',
                    artist: state.currentTrack?.artist ?? '---'
                  }),
                  'warning'
                )
              ]
            });
            return;
          }

          if (lyrics.plainLyrics) {
            const clipped =
              lyrics.plainLyrics.length > 3800
                ? `${lyrics.plainLyrics.slice(0, 3800)}\n\n...`
                : lyrics.plainLyrics;
            await interaction.editReply({
              embeds: [
                createSonoraStatusEmbed(
                  clipped,
                  'accent',
                  `♪ ${lyrics.trackTitle}${lyrics.artistName ? ` — ${lyrics.artistName}` : ''}`
                )
              ]
            });
          } else if (lyrics.externalUrl) {
            await interaction.editReply({
              embeds: [
                createSonoraStatusEmbed(
                  t(locale, 'lyrics.restrictedWithLink', { url: lyrics.externalUrl }),
                  'accent',
                  `♪ ${lyrics.trackTitle}`
                )
              ]
            });
          }
          return;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t(locale, 'common.error.unexpected');
      const embed = createSonoraStatusEmbed(message, 'error');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
}
