import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { logger, parseAppConfig, SONORA_BRAND } from '@sonora/shared';
import { SonoraBot } from './bot/sonora-bot.js';

export * from './bot/commands.js';
export * from './bot/embeds.js';
export * from './bot/command-router.js';
export * from './bot/sonora-bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function bootstrapServer(): Promise<SonoraBot> {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  const config = parseAppConfig(process.env);

  if (config.DISCORD_TOKEN === 'coloca_aqui_o_token_do_bot_sonora') {
    throw new Error(
      `[${SONORA_BRAND.name}] DISCORD_TOKEN ainda contém o valor de exemplo no ficheiro .env. ` +
        'Por favor, cola o Token real do teu bot na linha DISCORD_TOKEN= do ficheiro .env.'
    );
  }

  const bot = new SonoraBot(config);
  await bot.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, `[${SONORA_BRAND.name}] Sinal recebido. A encerrar graciosamente...`);
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  return bot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  bootstrapServer().catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : err }, 'Falha ao iniciar o servidor Sonora');
    process.exit(1);
  });
}
