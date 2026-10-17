import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Track, TrackRequester } from '@sonora/shared';
import {
  SpotifyMetadataAdapter,
  calculateTrackMatchScore,
  extractSpotifyTrackId,
  type AudioSourceAdapter,
  type PcmAudioStreamHandle
} from '../src/index.js';

class MockSearchAdapter implements AudioSourceAdapter {
  public readonly sourceType = 'youtube' as const;
  private readonly mockTitle: string;
  private readonly mockArtist: string;
  private readonly mockDurationMs: number;

  constructor(title = 'Starlight', artist = 'Muse', durationMs = 240_000) {
    this.mockTitle = title;
    this.mockArtist = artist;
    this.mockDurationMs = durationMs;
  }

  public canHandle(): boolean {
    return true;
  }

  public async resolveTrack(_query: string, requester: TrackRequester | null): Promise<Track> {
    return {
      id: 'yt-starlight',
      title: this.mockTitle,
      artist: this.mockArtist,
      durationMs: this.mockDurationMs,
      artworkUrl: 'https://i.ytimg.com/vi/starlight/hqdefault.jpg',
      source: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=starlight',
      requestedBy: requester,
      addedAt: new Date().toISOString()
    };
  }

  public async createPcmStream(): Promise<PcmAudioStreamHandle> {
    const stream = new PassThrough();
    return { stream, cleanup: () => stream.destroy() };
  }
}

describe('Fase 10 — SpotifyMetadataAdapter e Correspondência de Metadados', () => {
  it('extracts Spotify track IDs from standard and internationalized URLs', () => {
    expect(
      extractSpotifyTrackId('https://open.spotify.com/track/3cfOd4CMv2snFaKAnMdnvK?si=abc')
    ).toBe('3cfOd4CMv2snFaKAnMdnvK');
    expect(
      extractSpotifyTrackId('https://open.spotify.com/intl-pt/track/3cfOd4CMv2snFaKAnMdnvK')
    ).toBe('3cfOd4CMv2snFaKAnMdnvK');
    expect(extractSpotifyTrackId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('identifies track via public oEmbed and matches reliably to playback source without extracting Spotify audio', async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('open.spotify.com/oembed')) {
        return new Response(
          JSON.stringify({
            title: 'Starlight - Muse',
            thumbnail_url: 'https://i.scdn.co/image/starlight-cover'
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    };

    const adapter = new SpotifyMetadataAdapter({
      fallbackSearchAdapter: new MockSearchAdapter('Muse - Starlight (Official Video)', 'Muse', 240_000),
      fetchFn: mockFetch as typeof fetch
    });

    const track = await adapter.resolveTrack(
      'https://open.spotify.com/track/3cfOd4CMv2snFaKAnMdnvK',
      { id: 'u1', username: 'diogo' }
    );

    expect(track.title).toBe('Starlight');
    expect(track.artist).toBe('Muse');
    expect(track.artworkUrl).toBe('https://i.scdn.co/image/starlight-cover');
    expect(track.source).toBe('youtube');
    expect(track.matchedFromSpotifyUrl).toBe(
      'https://open.spotify.com/track/3cfOd4CMv2snFaKAnMdnvK'
    );
  });

  it('rejects unreliable matches when candidate track does not match Spotify metadata', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          title: 'Bohemian Rhapsody - Queen',
          thumbnail_url: 'https://i.scdn.co/image/queen'
        }),
        { status: 200 }
      );

    const adapter = new SpotifyMetadataAdapter({
      fallbackSearchAdapter: new MockSearchAdapter('Completely Unrelated Podcast Episode 99', 'Random Channel', 3_600_000),
      fetchFn: mockFetch as typeof fetch
    });

    await expect(
      adapter.resolveTrack('https://open.spotify.com/track/3cfOd4CMv2snFaKAnMdnvK', null)
    ).rejects.toThrow(/não foi encontrada uma correspondência fiável/);

    const badScore = calculateTrackMatchScore(
      {
        spotifyId: '1',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        durationMs: 354_000,
        artworkUrl: null,
        spotifyUrl: 'https://open.spotify.com/track/1'
      },
      {
        id: 'yt-bad',
        title: 'Unrelated Track',
        artist: 'Other',
        durationMs: 900_000,
        artworkUrl: null,
        source: 'youtube',
        sourceUrl: 'https://www.youtube.com/watch?v=bad',
        requestedBy: null,
        addedAt: new Date().toISOString()
      }
    );
    expect(badScore).toBeLessThan(0.45);
  });
});
