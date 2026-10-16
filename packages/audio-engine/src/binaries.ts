import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { logger } from '@sonora/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

export function resolveFfmpegBinaryPath(configuredPath?: string): string {
  if (configuredPath && configuredPath.trim().length > 0) {
    return configuredPath.trim();
  }
  if (typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return 'ffmpeg';
}

export function resolveYtDlpBinaryPath(configuredPath?: string): string {
  if (configuredPath && configuredPath.trim().length > 0) {
    return configuredPath.trim();
  }
  const isWin = process.platform === 'win32';
  const localBin = path.join(repoRoot, '.bin', isWin ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return isWin ? 'yt-dlp.exe' : 'yt-dlp';
}

export async function ensureYtDlpBinary(configuredPath?: string): Promise<string> {
  const candidate = resolveYtDlpBinaryPath(configuredPath);
  if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
    return candidate;
  }

  const isWin = process.platform === 'win32';
  const binDir = path.join(repoRoot, '.bin');
  const targetPath = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const downloadUrl = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  logger.info({ downloadUrl, targetPath }, '[Sonora Audio] A transferir binário oficial yt-dlp...');
  fs.mkdirSync(binDir, { recursive: true });

  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao transferir yt-dlp (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
  if (!isWin) {
    fs.chmodSync(targetPath, 0o755);
  }
  logger.info({ targetPath }, '[Sonora Audio] Binário yt-dlp pronto.');
  return targetPath;
}
