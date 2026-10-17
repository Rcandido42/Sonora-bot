import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SonoraDatabase } from './database.js';

export interface BackupMetadata {
  backupFilePath: string;
  sizeBytes: number;
  createdAt: string;
}

export async function createDatabaseBackup(
  sourceDbOrPath: SonoraDatabase | string,
  backupDir: string
): Promise<BackupMetadata> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `sonora-backup-${timestamp}.db`;
  const resolvedBackupDir = path.resolve(backupDir);
  fs.mkdirSync(resolvedBackupDir, { recursive: true });
  const destinationPath = path.join(resolvedBackupDir, fileName);

  let ownedDb: SonoraDatabase | null = null;
  try {
    const dbInstance =
      typeof sourceDbOrPath === 'string'
        ? (ownedDb = new SonoraDatabase(sourceDbOrPath))
        : sourceDbOrPath;

    await dbInstance.backupTo(destinationPath);
  } finally {
    if (ownedDb) {
      ownedDb.close();
    }
  }

  // Verifica a integridade da cópia gerada
  const checkDb = new Database(destinationPath, { readonly: true });
  try {
    const check = checkDb.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    if (check?.integrity_check !== 'ok') {
      throw new Error('A cópia de segurança gerada falhou na verificação de integridade.');
    }
  } finally {
    checkDb.close();
  }

  const stat = fs.statSync(destinationPath);
  return {
    backupFilePath: destinationPath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString()
  };
}

export function restoreDatabaseBackup(
  backupFilePath: string,
  targetDbPath: string
): { restoredPath: string; preRestoreSnapshotPath: string | null } {
  const resolvedBackup = path.resolve(backupFilePath);
  if (!fs.existsSync(resolvedBackup)) {
    throw new Error(`Ficheiro de cópia de segurança não encontrado: ${resolvedBackup}`);
  }

  // 1. Verifica se o ficheiro de backup é uma base de dados SQLite íntegra e contém as tabelas Sonora
  const verifyDb = new Database(resolvedBackup, { readonly: true });
  try {
    const check = verifyDb.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    if (check?.integrity_check !== 'ok') {
      throw new Error('O ficheiro de cópia de segurança está corrompido (integrity_check falhou).');
    }
    const hasTable = verifyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guild_settings'")
      .get();
    if (!hasTable) {
      throw new Error('O ficheiro indicado não contém o esquema da base de dados Sonora.');
    }
  } finally {
    verifyDb.close();
  }

  const resolvedTarget = path.resolve(targetDbPath);
  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });

  // 2. Se já existir uma base de dados no destino, guarda um snapshot de segurança pré-restauro
  let preRestoreSnapshotPath: string | null = null;
  if (fs.existsSync(resolvedTarget)) {
    preRestoreSnapshotPath = `${resolvedTarget}.pre-restore-${Date.now()}.bak`;
    fs.copyFileSync(resolvedTarget, preRestoreSnapshotPath);
  }

  // Remove ficheiros temporários WAL/SHM antigos antes de substituir a base de dados
  for (const suffix of ['-wal', '-shm']) {
    const walFile = `${resolvedTarget}${suffix}`;
    if (fs.existsSync(walFile)) {
      fs.rmSync(walFile, { force: true });
    }
  }

  fs.copyFileSync(resolvedBackup, resolvedTarget);
  return {
    restoredPath: resolvedTarget,
    preRestoreSnapshotPath
  };
}
