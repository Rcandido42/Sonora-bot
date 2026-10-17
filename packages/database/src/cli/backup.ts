import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger, SONORA_BRAND } from '@sonora/shared';
import { createDatabaseBackup } from '../backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../');

async function main() {
  const dbPath = path.resolve(repoRoot, process.env.DATABASE_PATH ?? './data/sonora.db');
  const backupDir = path.resolve(repoRoot, process.env.BACKUP_DIR ?? './backups');

  const meta = await createDatabaseBackup(dbPath, backupDir);
  logger.info(
    meta,
    `[${SONORA_BRAND.name}] Cópia de segurança da base de dados concluída com sucesso.`
  );
}

main().catch((err) => {
  logger.error({ err }, `[${SONORA_BRAND.name}] Falha ao criar cópia de segurança.`);
  process.exit(1);
});
