import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  resolveSafeUrlWithRedirects,
  type SafeUrlValidationOptions,
  type Track,
  type TrackRequester
} from '@sonora/shared';
import { resolveFfmpegBinaryPath } from '../binaries.js';
import type { AudioSourceAdapter, PcmAudioStreamHandle } from './types.js';

const DIRECT_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.ogg',
  '.wav',
  '.opus',
  '.m4a',
  '.aac',
  '.webm'
]);

export interface DirectAudioAdapterOptions extends SafeUrlValidationOptions {
  ffmpegPath?: string;
}

export class DirectAudioAdapter implements AudioSourceAdapter {
  public readonly sourceType = 'direct' as const;
  private readonly options: DirectAudioAdapterOptions;

  constructor(options: DirectAudioAdapterOptions = {}) {
    this.options = options;
  }

  public canHandle(queryOrUrl: string): boolean {
    try {
      const parsed = new URL(queryOrUrl.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host.includes('youtube.com') ||
        host.includes('youtu.be') ||
        host.includes('soundcloud.com') ||
        host.includes('spotify.com')
      ) {
        return false;
      }
      const ext = path.posix.extname(parsed.pathname.toLowerCase());
      return DIRECT_AUDIO_EXTENSIONS.has(ext);
    } catch {
      return false;
    }
  }

  public async resolveTrack(
    queryOrUrl: string,
    requester: TrackRequester | null
  ): Promise<Track> {
    const { finalUrl, contentType } = await resolveSafeUrlWithRedirects(queryOrUrl, this.options);

    if (
      contentType &&
      !contentType.toLowerCase().startsWith('audio/') &&
      !contentType.toLowerCase().startsWith('application/octet-stream') &&
      !contentType.toLowerCase().startsWith('video/ogg') &&
      !contentType.toLowerCase().startsWith('video/webm')
    ) {
      throw new Error(`O URL indicado não devolveu um formato de áudio válido (${contentType}).`);
    }

    const rawName = decodeURIComponent(path.posix.basename(finalUrl.pathname)) || 'Direct Audio Stream';
    const cleanTitle = rawName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]+/g, ' ').trim();

    return {
      id: `direct-${Buffer.from(finalUrl.toString()).toString('base64url').slice(0, 24)}`,
      title: cleanTitle || 'Stream de Áudio Direto',
      artist: finalUrl.hostname,
      durationMs: null,
      artworkUrl: null,
      source: 'direct',
      sourceUrl: finalUrl.toString(),
      streamUrl: finalUrl.toString(),
      requestedBy: requester,
      addedAt: new Date().toISOString()
    };
  }

  public async createPcmStream(track: Track): Promise<PcmAudioStreamHandle> {
    // Revalida o URL mesmo antes de reproduzir para impedir DNS rebinding
    const { finalUrl } = await resolveSafeUrlWithRedirects(
      track.streamUrl ?? track.sourceUrl,
      this.options
    );
    const ffmpegBin = resolveFfmpegBinaryPath(this.options.ffmpegPath);

    const ffmpegProc = spawn(
      ffmpegBin,
      [
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '4',
        '-i',
        finalUrl.toString(),
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
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );

    const cleanup = () => {
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
