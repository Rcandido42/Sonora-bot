import { describe, it, expect, vi } from 'vitest';
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import {
  SONORA_COMMAND_NAMES,
  buildSonoraSlashCommands,
  InMemoryFallbackPlaybackPort,
  SonoraCommandRouter
} from '../src/index.js';

function createMockInteraction(params: {
  commandName: string;
  guildId?: string | null;
  userId?: string;
  username?: string;
  isAdmin?: boolean;
  voiceChannelId?: string | null;
  voiceChannelName?: string;
  stringOptions?: Record<string, string>;
  integerOptions?: Record<string, number>;
}) {
  const replies: unknown[] = [];
  const edits: unknown[] = [];

  const interaction = {
    commandName: params.commandName,
    guildId: params.guildId === undefined ? '111222333444555666' : params.guildId,
    channelId: '999888777666555444',
    deferred: false,
    replied: false,
    user: {
      id: params.userId ?? 'user-1',
      username: params.username ?? 'diogo',
      displayName: params.username ?? 'Diogo',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
    },
    memberPermissions: {
      has: (flag: bigint) =>
        Boolean(
          params.isAdmin &&
            (flag === PermissionFlagsBits.Administrator || flag === PermissionFlagsBits.ManageGuild)
        )
    },
    member: {
      roles: {
        cache: new Map<string, unknown>()
      },
      voice: {
        channel: params.voiceChannelId
          ? {
              id: params.voiceChannelId,
              name: params.voiceChannelName ?? 'Música Geral',
              members: {
                filter: () => ({ size: 1 })
              }
            }
          : null
      }
    },
    options: {
      getString: (name: string, required?: boolean) => {
        const val = params.stringOptions?.[name] ?? null;
        if (required && val === null) throw new Error(`Missing required string option ${name}`);
        return val;
      },
      getInteger: (name: string, required?: boolean) => {
        const val = params.integerOptions?.[name] ?? null;
        if (required && val === null) throw new Error(`Missing required integer option ${name}`);
        return val;
      }
    },
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    reply: vi.fn(async (payload: unknown) => {
      interaction.replied = true;
      replies.push(payload);
    }),
    editReply: vi.fn(async (payload: unknown) => {
      edits.push(payload);
    })
  };

  return {
    interaction: interaction as unknown as ChatInputCommandInteraction,
    replies,
    edits
  };
}

describe('Fase 3 — Bot Discord e Comandos Slash da Sonora', () => {
  it('defines all 16 required slash commands with valid schemas and localizations', () => {
    const commands = buildSonoraSlashCommands();
    expect(commands).toHaveLength(16);
    const names = commands.map((c) => c.name);
    expect(names).toEqual([...SONORA_COMMAND_NAMES]);

    for (const cmd of commands) {
      expect(cmd.description.length).toBeGreaterThan(5);
      expect(cmd.description_localizations?.['en-US']).toBeDefined();
    }
  });

  it('handles /help and /language with admin permission enforcement and pt-PT/en switching', async () => {
    const port = new InMemoryFallbackPlaybackPort('pt-PT');
    const router = new SonoraCommandRouter(port);

    // 1. /help em pt-PT
    const helpPt = createMockInteraction({ commandName: 'help' });
    await router.handleChatInputCommand(helpPt.interaction);
    expect(helpPt.replies).toHaveLength(1);
    const embedPt = (helpPt.replies[0] as { embeds: Array<{ data: { title: string } }> }).embeds[0];
    expect(embedPt.data.title).toContain('Comandos da Sonora');

    // 2. /language por utilizador sem permissão de Admin deve falhar
    const langDenied = createMockInteraction({
      commandName: 'language',
      isAdmin: false,
      stringOptions: { locale: 'en' }
    });
    await router.handleChatInputCommand(langDenied.interaction);
    const deniedEmbed = (langDenied.replies[0] as { embeds: Array<{ data: { description: string } }> }).embeds[0];
    expect(deniedEmbed.data.description).toContain('Administradores');

    // 3. /language por Admin muda para Inglês
    const langAllowed = createMockInteraction({
      commandName: 'language',
      isAdmin: true,
      stringOptions: { locale: 'en' }
    });
    await router.handleChatInputCommand(langAllowed.interaction);
    expect(port.getGuildLocale('111222333444555666')).toBe('en');

    // 4. /help agora responde em Inglês
    const helpEn = createMockInteraction({ commandName: 'help' });
    await router.handleChatInputCommand(helpEn.interaction);
    const embedEn = (helpEn.replies[0] as { embeds: Array<{ data: { title: string } }> }).embeds[0];
    expect(embedEn.data.title).toContain('Sonora Commands');
  });

  it('validates voice channel preconditions and executes playback/queue slash commands', async () => {
    const port = new InMemoryFallbackPlaybackPort('pt-PT');
    const router = new SonoraCommandRouter(port);
    const guildId = '111222333444555666';

    // /play fora de canal de voz é rejeitado
    const playNoVoice = createMockInteraction({
      commandName: 'play',
      voiceChannelId: null,
      stringOptions: { query: 'Daft Punk - Veridis Quo' }
    });
    await router.handleChatInputCommand(playNoVoice.interaction);
    const noVoiceDesc = (playNoVoice.replies[0] as { embeds: Array<{ data: { description: string } }> }).embeds[0].data
      .description;
    expect(noVoiceDesc).toContain('canal de voz');

    // /play num canal de voz inicia a primeira faixa
    const playFirst = createMockInteraction({
      commandName: 'play',
      voiceChannelId: 'voice-1',
      stringOptions: { query: 'Daft Punk - Veridis Quo' }
    });
    await router.handleChatInputCommand(playFirst.interaction);
    expect(playFirst.edits).toHaveLength(1);
    expect(port.getState(guildId).currentTrack?.title).toBe('Daft Punk - Veridis Quo');
    expect(port.getState(guildId).status).toBe('playing');

    // /play da segunda e terceira faixa adiciona à fila
    for (const q of ['M83 - Midnight City', 'Justice - D.A.N.C.E.']) {
      const playNext = createMockInteraction({
        commandName: 'play',
        voiceChannelId: 'voice-1',
        stringOptions: { query: q }
      });
      await router.handleChatInputCommand(playNext.interaction);
    }
    expect(port.getState(guildId).queue).toHaveLength(2);

    // Utilizador noutro canal de voz é bloqueado
    const wrongVoice = createMockInteraction({
      commandName: 'pause',
      voiceChannelId: 'voice-other'
    });
    await router.handleChatInputCommand(wrongVoice.interaction);
    const wrongVoiceDesc = (wrongVoice.replies[0] as { embeds: Array<{ data: { description: string } }> }).embeds[0]
      .data.description;
    expect(wrongVoiceDesc).toContain('mesmo canal de voz');

    // /pause e /resume
    const pauseCmd = createMockInteraction({ commandName: 'pause', voiceChannelId: 'voice-1' });
    await router.handleChatInputCommand(pauseCmd.interaction);
    expect(port.getState(guildId).status).toBe('paused');

    const resumeCmd = createMockInteraction({ commandName: 'resume', voiceChannelId: 'voice-1' });
    await router.handleChatInputCommand(resumeCmd.interaction);
    expect(port.getState(guildId).status).toBe('playing');

    // /volume, /loop, /shuffle, /queue
    const volCmd = createMockInteraction({
      commandName: 'volume',
      voiceChannelId: 'voice-1',
      integerOptions: { level: 120 }
    });
    await router.handleChatInputCommand(volCmd.interaction);
    expect(port.getState(guildId).volume).toBe(120);

    const loopCmd = createMockInteraction({
      commandName: 'loop',
      voiceChannelId: 'voice-1',
      stringOptions: { mode: 'queue' }
    });
    await router.handleChatInputCommand(loopCmd.interaction);
    expect(port.getState(guildId).loopMode).toBe('queue');

    const shuffleCmd = createMockInteraction({ commandName: 'shuffle', voiceChannelId: 'voice-1' });
    await router.handleChatInputCommand(shuffleCmd.interaction);
    expect(port.getState(guildId).shuffled).toBe(true);

    // /remove, /skip, /clear, /stop, /leave
    const removeCmd = createMockInteraction({
      commandName: 'remove',
      voiceChannelId: 'voice-1',
      integerOptions: { position: 1 }
    });
    await router.handleChatInputCommand(removeCmd.interaction);
    expect(port.getState(guildId).queue).toHaveLength(1);

    const skipCmd = createMockInteraction({ commandName: 'skip', voiceChannelId: 'voice-1' });
    await router.handleChatInputCommand(skipCmd.interaction);
    expect(port.getState(guildId).queue).toHaveLength(0);

    const stopCmd = createMockInteraction({ commandName: 'stop', voiceChannelId: 'voice-1' });
    await router.handleChatInputCommand(stopCmd.interaction);
    expect(port.getState(guildId).currentTrack).toBeNull();

    const leaveCmd = createMockInteraction({ commandName: 'leave', voiceChannelId: 'voice-1' });
    await router.handleChatInputCommand(leaveCmd.interaction);
    expect(port.getState(guildId).botConnected).toBe(false);
  });
});
