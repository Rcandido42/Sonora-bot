import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes
} from 'discord.js';
import { logger, SONORA_BRAND, type AppConfig } from '@sonora/shared';
import { buildSonoraSlashCommands } from './commands.js';
import {
  SonoraCommandRouter,
  type BotPlaybackPort
} from './command-router.js';
import { RealAudioPlaybackPort } from './real-playback-port.js';

export class SonoraBot {
  public readonly client: Client;
  public readonly router: SonoraCommandRouter;
  public readonly playback: BotPlaybackPort;
  private readonly config: AppConfig;

  constructor(config: AppConfig, playback?: BotPlaybackPort) {
    this.config = config;
    this.playback = playback ?? new RealAudioPlaybackPort(config);
    this.router = new SonoraCommandRouter(this.playback);

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });

    this.registerEventListeners();
  }

  private registerEventListeners(): void {
    this.client.once(Events.ClientReady, async (readyClient) => {
      logger.info(
        {
          botTag: readyClient.user.tag,
          botId: readyClient.user.id,
          guildCount: readyClient.guilds.cache.size
        },
        `[${SONORA_BRAND.name}] Bot ligado ao Discord com sucesso.`
      );

      readyClient.user.setPresence({
        status: 'online',
        activities: [
          {
            name: `${SONORA_BRAND.name} • /help | /play`,
            type: ActivityType.Listening
          }
        ]
      });

      await this.syncSlashCommands();
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.router.handleChatInputCommand(interaction);
      } else if (interaction.isButton()) {
        await this.router.handleButtonInteraction(interaction);
      }
    });

    this.client.on(Events.Error, (err) => {
      logger.error({ err }, `[${SONORA_BRAND.name}] Erro no cliente Discord.`);
    });
  }

  public async syncSlashCommands(): Promise<void> {
    const commandsPayload = buildSonoraSlashCommands();
    const rest = new REST({ version: '10' }).setToken(this.config.DISCORD_TOKEN);

    const targetGuildIds = new Set<string>();
    if (
      this.config.DISCORD_GUILD_ID &&
      this.config.DISCORD_GUILD_ID !== '000000000000000000'
    ) {
      targetGuildIds.add(this.config.DISCORD_GUILD_ID);
    } else {
      for (const guildId of this.client.guilds.cache.keys()) {
        targetGuildIds.add(guildId);
      }
    }

    if (targetGuildIds.size === 0) {
      logger.warn(
        `[${SONORA_BRAND.name}] Nenhum servidor encontrado para registar comandos de guild. A registar globalmente...`
      );
      await rest.put(Routes.applicationCommands(this.config.DISCORD_CLIENT_ID), {
        body: commandsPayload
      });
      return;
    }

    for (const guildId of targetGuildIds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(this.config.DISCORD_CLIENT_ID, guildId),
          { body: commandsPayload }
        );
        logger.info(
          { guildId, commandCount: commandsPayload.length },
          `[${SONORA_BRAND.name}] 16 comandos slash sincronizados no servidor.`
        );
      } catch (err) {
        logger.error(
          { err, guildId },
          `[${SONORA_BRAND.name}] Falha ao sincronizar comandos slash no servidor.`
        );
      }
    }
  }

  public async start(): Promise<void> {
    await this.client.login(this.config.DISCORD_TOKEN);
  }

  public async stop(): Promise<void> {
    logger.info(`[${SONORA_BRAND.name}] A encerrar ligação do bot Discord...`);
    await this.client.destroy();
  }
}
