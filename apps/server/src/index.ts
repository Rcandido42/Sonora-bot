import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { logger, parseAppConfig, SONORA_BRAND } from '@sonora/shared';
import { SonoraBot } from './bot/sonora-bot.js';
import { RealAudioPlaybackPort } from './bot/real-playback-port.js';
import { createSonoraApiServer } from './api/server.js';

export * from './bot/commands.js';
export * from './bot/embeds.js';
export * from './bot/command-router.js';
export * from './bot/real-playback-port.js';
export * from './bot/sonora-bot.js';
export * from './api/auth.js';
export * from './api/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function bootstrapServer() {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  const config = parseAppConfig(process.env);

  const playback = new RealAudioPlaybackPort(config);
  const bot = new SonoraBot(config, playback);

  const api = await createSonoraApiServer({
    config,
    playback,
    database: playback.database,
    botClient: bot.client
  });

  await api.listen({
    host: config.HOST,
    port: config.PORT
  });

  logger.info(
    {
      host: config.HOST,
      port: config.PORT,
      publicWebUrl: config.PUBLIC_WEB_URL
    },
    `[${SONORA_BRAND.name}] Servidor API & WebSocket ativo em http://${config.HOST}:${config.PORT}`
  );

  if (config.DISCORD_TOKEN !== 'coloca_aqui_o_token_do_bot_sonora') {
    await bot.start();
  } else {
    logger.warn(
      `[${SONORA_BRAND.name}] DISCORD_TOKEN ainda contém o valor de exemplo. O servidor API/Web está ativo, mas o bot Discord aguarda o token real no .env.`
    );
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, `[${SONORA_BRAND.name}] Sinal recebido. A encerrar graciosamente...`);
    await api.close();
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  return { bot, api, playback };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  bootstrapServer().catch((err) => {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      'Falha ao iniciar o servidor Sonora'
    );
    process.exit(1);
  });
}
