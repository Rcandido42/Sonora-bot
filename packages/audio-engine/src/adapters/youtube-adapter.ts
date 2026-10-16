import { spawn } from 'node:child_process';
import type { Track, TrackRequester } from '@sonora/shared';
import { ensureYtDlpBinary, resolveFfmpegBinaryPath } from '../binaries.js';
import type { AudioSourceAdapter, PcmAudioStreamHandle } from './types.js';

export interface YouTubeAdapterOptions {
  ytDlpPath?: string;
  ffmpegPath?: string;
}

interface YtDlpTrackMetadata {
  id?: string;
  title?: string;
  track?: string;
  artist?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  original_url?: string;
}

export function isYouTubeUrl(input: string): boolean {
  try {
    const parsed = new URL(input.trim());
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtu.be'
    );
  } catch {
    return false;
  }
}

export class YouTubeAdapter implements AudioSourceAdapter {
  public readonly sourceType = 'youtube' as const;
  private readonly options: YouTubeAdapterOptions;

  constructor(options: YouTubeAdapterOptions = {}) {
    this.options = options;
  }

  public canHandle(queryOrUrl: string): boolean {
    const trimmed = queryOrUrl.trim();
    if (!trimmed) return false;
    if (isYouTubeUrl(trimmed)) return true;
    // Se não for um URL HTTP/HTTPS de outro serviço, pode ser pesquisado no YouTube por nome/artista
    return !/^https?:\/\//i.test(trimmed);
  }

  public async resolveTrack(
    queryOrUrl: string,
    requester: TrackRequester | null
  ): Promise<Track> {
    const trimmed = queryOrUrl.trim();
    const target = isYouTubeUrl(trimmed) ? trimmed : `ytsearch1:${trimmed}`;
    const ytDlpBin = await ensureYtDlpBinary(this.options.ytDlpPath);

    const metadata = await new Promise<YtDlpTrackMetadata>((resolve, reject) => {
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
              stderr.trim() || `Não foi encontrada nenhuma faixa no YouTube (código ${code ?? -1}).`
            )
          );
          return;
        }

        try {
          resolve(JSON.parse(firstLine) as YtDlpTrackMetadata);
        } catch (err) {
          reject(err);
        }
      });
    });

    if (!metadata || (!metadata.webpage_url && !metadata.id)) {
      throw new Error('Não foi encontrada nenhuma correspondência no YouTube.');
    }

    const videoId = metadata.id ?? `${Date.now()}`;
    const canonicalUrl =
      metadata.webpage_url ?? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

    return {
      id: `yt-${videoId}`,
      title: (metadata.track || metadata.title || trimmed).trim(),
      artist: (metadata.artist || metadata.uploader || metadata.channel || 'YouTube').trim(),
      durationMs:
        typeof metadata.duration === 'number' && metadata.duration > 0
          ? Math.round(metadata.duration * 1000)
          : null,
      artworkUrl: metadata.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      source: 'youtube',
      sourceUrl: canonicalUrl,
      requestedBy: requester,
      addedAt: new Date().toISOString()
    };
  }

  public async createPcmStream(track: Track): Promise<PcmAudioStreamHandle> {
    const ytDlpBin = await ensureYtDlpBinary(this.options.ytDlpPath);
    const ffmpegBin = resolveFfmpegBinaryPath(this.options.ffmpegPath);

    const ytProc = spawn(
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

    ytProc.stdout.on('error', () => {
      // Ignora erros EPIPE ao interromper ou avançar faixas
    });
    ffmpegProc.stdin.on('error', () => {
      // Ignora erros EPIPE quando o FFmpeg encerra antes do yt-dlp
    });

    ytProc.stdout.pipe(ffmpegProc.stdin);

    const cleanup = () => {
      try {
        ytProc.stdout.unpipe(ffmpegProc.stdin);
      } catch {
        // Ignorado
      }
      if (!ytProc.killed) {
        ytProc.kill('SIGKILL');
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
