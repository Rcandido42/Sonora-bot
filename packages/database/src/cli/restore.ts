import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger, SONORA_BRAND } from '@sonora/shared';
import { restoreDatabaseBackup } from '../backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../');

async function main() {
  const targetDbPath = path.resolve(repoRoot, process.env.DATABASE_PATH ?? './data/sonora.db');
  const backupDir = path.resolve(repoRoot, process.env.BACKUP_DIR ?? './backups');
  let sourceBackup = process.argv[2];

  if (!sourceBackup) {
    if (!fs.existsSync(backupDir)) {
      throw new Error(`Diretório de cópias de segurança não encontrado: ${backupDir}`);
    }
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith('.db'))
      .sort()
      .reverse();

    if (files.length === 0) {
      throw new Error(`Nenhuma cópia de segurança (.db) encontrada em ${backupDir}`);
    }
    sourceBackup = path.join(backupDir, files[0]);
  } else if (!path.isAbsolute(sourceBackup)) {
    sourceBackup = path.resolve(process.cwd(), sourceBackup);
  }

  const result = restoreDatabaseBackup(sourceBackup, targetDbPath);
  logger.info(
    { sourceBackup, ...result },
    `[${SONORA_BRAND.name}] Base de dados restaurada com sucesso.`
  );
}

main().catch((err) => {
  logger.error({ err }, `[${SONORA_BRAND.name}] Falha ao restaurar cópia de segurança.`);
  process.exit(1);
});
