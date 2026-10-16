import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { logger, parseAppConfig, SONORA_BRAND } from '@sonora/shared';
import { buildSonoraSlashCommands } from '../bot/commands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

async function main() {
  const config = parseAppConfig(process.env);
  const commandsPayload = buildSonoraSlashCommands();
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

  if (config.DISCORD_GUILD_ID && config.DISCORD_GUILD_ID !== '000000000000000000') {
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
      { body: commandsPayload }
    );
    logger.info(
      { guildId: config.DISCORD_GUILD_ID, count: commandsPayload.length },
      `[${SONORA_BRAND.name}] Comandos slash registados com sucesso no servidor.`
    );
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
      body: commandsPayload
    });
    logger.info(
      { count: commandsPayload.length },
      `[${SONORA_BRAND.name}] Comandos slash registados globalmente.`
    );
  }
}

main().catch((err) => {
  logger.error({ err }, `[${SONORA_BRAND.name}] Erro ao registar comandos slash.`);
  process.exit(1);
});
