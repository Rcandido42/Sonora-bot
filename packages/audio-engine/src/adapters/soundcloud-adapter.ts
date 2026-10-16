import { spawn } from 'node:child_process';
import type { Track, TrackRequester } from '@sonora/shared';
import { ensureYtDlpBinary, resolveFfmpegBinaryPath } from '../binaries.js';
import type { AudioSourceAdapter, PcmAudioStreamHandle } from './types.js';

export interface SoundCloudAdapterOptions {
  ytDlpPath?: string;
  ffmpegPath?: string;
}

interface SoundCloudRawMetadata {
  id?: string | number;
  title?: string;
  uploader?: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
}

export function isSoundCloudUrl(input: string): boolean {
  try {
    const parsed = new URL(input.trim());
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'soundcloud.com' ||
      host === 'www.soundcloud.com' ||
      host === 'm.soundcloud.com' ||
      host === 'on.soundcloud.com'
    );
  } catch {
    return false;
  }
}

export class SoundCloudAdapter implements AudioSourceAdapter {
  public readonly sourceType = 'soundcloud' as const;
  private readonly options: SoundCloudAdapterOptions;

  constructor(options: SoundCloudAdapterOptions = {}) {
    this.options = options;
  }

  public canHandle(queryOrUrl: string): boolean {
    const trimmed = queryOrUrl.trim();
    return isSoundCloudUrl(trimmed) || trimmed.toLowerCase().startsWith('scsearch:');
  }

  public async resolveTrack(
    queryOrUrl: string,
    requester: TrackRequester | null
  ): Promise<Track> {
    const trimmed = queryOrUrl.trim();
    const target = isSoundCloudUrl(trimmed)
      ? trimmed
      : `scsearch1:${trimmed.replace(/^scsearch:/i, '').trim()}`;

    const ytDlpBin = await ensureYtDlpBinary(this.options.ytDlpPath);

    const metadata = await new Promise<SoundCloudRawMetadata>((resolve, reject) => {
      const proc = spawn(
        ytDlpBin,
        ['--dump-json', '--no-playlist', '--no-warnings', target],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        const firstLine = stdout
          .trim()
          .split(/\r?\n/)
          .find((line) => line.trim().startsWith('{'));

        if (!firstLine) {
          reject(
            new Error(
              stderr.trim() || `Não foi encontrada nenhuma faixa no SoundCloud (código ${code ?? -1}).`
            )
          );
          return;
        }

        try {
          resolve(JSON.parse(firstLine) as SoundCloudRawMetadata);
        } catch (err) {
          reject(err);
        }
      });
    });

    if (!metadata || !metadata.webpage_url) {
      throw new Error('Não foi encontrada nenhuma correspondência no SoundCloud.');
    }

    const trackId = String(metadata.id ?? Date.now());
    return {
      id: `sc-${trackId}`,
      title: (metadata.title || 'SoundCloud Track').trim(),
      artist: (metadata.artist || metadata.uploader || 'SoundCloud').trim(),
      durationMs:
        typeof metadata.duration === 'number' && metadata.duration > 0
          ? Math.round(metadata.duration * 1000)
          : null,
      artworkUrl: metadata.thumbnail ?? null,
      source: 'soundcloud',
      sourceUrl: metadata.webpage_url,
      requestedBy: requester,
      addedAt: new Date().toISOString()
    };
  }

  public async createPcmStream(track: Track): Promise<PcmAudioStreamHandle> {
    const ytDlpBin = await ensureYtDlpBinary(this.options.ytDlpPath);
    const ffmpegBin = resolveFfmpegBinaryPath(this.options.ffmpegPath);

    const scProc = spawn(
      ytDlpBin,
      [
        '-f',
        'bestaudio/best',
        '--no-playlist',
        '--no-warnings',
        '-q',
        '-o',
        '-',
        track.sourceUrl
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );

    const ffmpegProc = spawn(
      ffmpegBin,
      [
        '-i',
        'pipe:0',
        '-vn',
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        'pipe:1'
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      }
    );

    scProc.stdout.on('error', () => {});
    ffmpegProc.stdin.on('error', () => {});
    scProc.stdout.pipe(ffmpegProc.stdin);

    const cleanup = () => {
      try {
        scProc.stdout.unpipe(ffmpegProc.stdin);
      } catch {
        // Ignorado
      }
      if (!scProc.killed) {
        scProc.kill('SIGKILL');
      }
      if (!ffmpegProc.killed) {
        ffmpegProc.kill('SIGKILL');
      }
    };

    ffmpegProc.stdout.once('close', cleanup);
    ffmpegProc.stdout.once('error', cleanup);

    return {
      stream: ffmpegProc.stdout,
      cleanup
    };
  }
}
