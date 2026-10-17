import type { Track, TrackRequester } from '@sonora/shared';
import type { AudioSourceAdapter, PcmAudioStreamHandle } from './types.js';

export interface SpotifyTrackMetadata {
  spotifyId: string;
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
  spotifyUrl: string;
}

export interface SpotifyMetadataAdapterOptions {
  clientId?: string;
  clientSecret?: string;
  fallbackSearchAdapter: AudioSourceAdapter;
  fetchFn?: typeof fetch;
  minMatchScore?: number;
}

export function extractSpotifyTrackId(input: string): string | null {
  try {
    const parsed = new URL(input.trim());
    const host = parsed.hostname.toLowerCase();
    if (host !== 'open.spotify.com' && host !== 'spotify.link') {
      return null;
    }
    // Suporta /track/{id} e /intl-pt/track/{id}
    const match = parsed.pathname.match(/\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/([a-zA-Z0-9]{15,30})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(official.*?\)|\[official.*?\]|\(lyrics.*?\)|\[lyrics.*?\]|\(audio\)|\[audio\]/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateTrackMatchScore(
  spotifyMeta: SpotifyTrackMetadata,
  candidate: Track
): number {
  const normSpotifyTitle = normalizeForComparison(spotifyMeta.title);
  const normSpotifyArtist = normalizeForComparison(spotifyMeta.artist);
  const normCandTitle = normalizeForComparison(candidate.title);
  const normCandArtist = normalizeForComparison(candidate.artist);
  const combinedCandidate = `${normCandTitle} ${normCandArtist}`.trim();

  if (!normSpotifyTitle || !combinedCandidate) return 0;

  // 1. Pontuação do título (até 0.6)
  const titleTokens = normSpotifyTitle.split(' ').filter((w) => w.length > 1);
  let matchedTitleTokens = 0;
  for (const token of titleTokens) {
    if (combinedCandidate.includes(token)) {
      matchedTitleTokens++;
    }
  }
  const titleRatio =
    titleTokens.length > 0
      ? matchedTitleTokens / titleTokens.length
      : combinedCandidate.includes(normSpotifyTitle)
        ? 1
        : 0;
  const titleScore = titleRatio * 0.6;

  // 2. Pontuação do artista (até 0.25)
  let artistScore = 0;
  if (normSpotifyArtist) {
    const artistTokens = normSpotifyArtist.split(' ').filter((w) => w.length > 1);
    const matchedArtist = artistTokens.filter((w) => combinedCandidate.includes(w)).length;
    artistScore = artistTokens.length > 0 ? (matchedArtist / artistTokens.length) * 0.25 : 0.15;
  } else {
    artistScore = 0.15;
  }

  // 3. Proximidade de duração, quando disponível em ambos (até 0.15)
  let durationScore = 0.1;
  if (spotifyMeta.durationMs && candidate.durationMs) {
    const diffSec = Math.abs(spotifyMeta.durationMs - candidate.durationMs) / 1000;
    if (diffSec <= 8) durationScore = 0.15;
    else if (diffSec <= 25) durationScore = 0.1;
    else if (diffSec <= 60) durationScore = 0.04;
    else durationScore = 0;
  }

  return Number((titleScore + artistScore + durationScore).toFixed(3));
}

export class SpotifyMetadataAdapter implements AudioSourceAdapter {
  public readonly sourceType = 'youtube' as const;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fallbackAdapter: AudioSourceAdapter;
  private readonly fetchFn: typeof fetch;
  private readonly minMatchScore: number;
  private cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

  constructor(options: SpotifyMetadataAdapterOptions) {
    this.clientId = options.clientId ?? '';
    this.clientSecret = options.clientSecret ?? '';
    this.fallbackAdapter = options.fallbackSearchAdapter;
    this.fetchFn = options.fetchFn ?? fetch;
    this.minMatchScore = options.minMatchScore ?? 0.45;
  }

  public canHandle(queryOrUrl: string): boolean {
    return extractSpotifyTrackId(queryOrUrl) !== null;
  }

  private async getSpotifyApiToken(): Promise<string | null> {
    if (!this.clientId || !this.clientSecret) return null;
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs > Date.now() + 10_000) {
      return this.cachedAccessToken.token;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetchFn('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    this.cachedAccessToken = {
      token: data.access_token,
      expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000
    };
    return data.access_token;
  }

  public async identifyTrack(spotifyUrl: string): Promise<SpotifyTrackMetadata> {
    const trackId = extractSpotifyTrackId(spotifyUrl);
    if (!trackId) {
      throw new Error('Link do Spotify inválido ou não suportado.');
    }

    const canonicalSpotifyUrl = `https://open.spotify.com/track/${trackId}`;

    // 1. Tenta a Spotify Web API oficial (quando SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET estão configurados)
    const token = await this.getSpotifyApiToken();
    if (token) {
      const apiRes = await this.fetchFn(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (apiRes.ok) {
        const trackData = (await apiRes.json()) as {
          name?: string;
          duration_ms?: number;
          artists?: Array<{ name?: string }>;
          album?: { images?: Array<{ url?: string }> };
        };

        if (trackData.name) {
          return {
            spotifyId: trackId,
            title: trackData.name,
            artist: trackData.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Spotify',
            durationMs: trackData.duration_ms ?? null,
            artworkUrl: trackData.album?.images?.[0]?.url ?? null,
            spotifyUrl: canonicalSpotifyUrl
          };
        }
      }
    }

    // 2. Fallback público documentado: Endpoint oficial Spotify oEmbed (não extrai áudio, apenas metadados públicos)
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalSpotifyUrl)}`;
    const oembedRes = await this.fetchFn(oembedUrl, {
      headers: { 'User-Agent': 'Sonora/1.0.0' }
    });

    if (!oembedRes.ok) {
      throw new Error('Não foi possível identificar a faixa através do Spotify.');
    }

    const oembedData = (await oembedRes.json()) as {
      title?: string;
      thumbnail_url?: string;
    };

    if (!oembedData.title) {
      throw new Error('Metadados do Spotify indisponíveis para este link.');
    }

    // Alguns títulos oEmbed vêm no formato "Título - Artista" ou apenas "Título"
    let title = oembedData.title.trim();
    let artist = '';
    if (title.includes(' - ')) {
      const [tPart, aPart] = title.split(' - ', 2);
      title = tPart.trim();
      artist = aPart.trim();
    }

    return {
      spotifyId: trackId,
      title,
      artist,
      durationMs: null,
      artworkUrl: oembedData.thumbnail_url ?? null,
      spotifyUrl: canonicalSpotifyUrl
    };
  }

  public async resolveTrack(
    spotifyUrl: string,
    requester: TrackRequester | null
  ): Promise<Track> {
    const meta = await this.identifyTrack(spotifyUrl);
    const searchQuery = meta.artist ? `${meta.title} ${meta.artist}` : meta.title;

    const candidate = await this.fallbackAdapter.resolveTrack(searchQuery, requester);
    const matchScore = calculateTrackMatchScore(meta, candidate);

    if (matchScore < this.minMatchScore) {
      throw new Error(
        `A faixa foi identificada no Spotify (${meta.title}${meta.artist ? ` — ${meta.artist}` : ''}), mas não foi encontrada uma correspondência fiável para reprodução.`
      );
    }

    return {
      ...candidate,
      title: meta.title,
      artist: meta.artist || candidate.artist,
      artworkUrl: meta.artworkUrl ?? candidate.artworkUrl,
      durationMs: candidate.durationMs ?? meta.durationMs,
      matchedFromSpotifyUrl: meta.spotifyUrl
    };
  }

  public async createPcmStream(track: Track): Promise<PcmAudioStreamHandle> {
    return this.fallbackAdapter.createPcmStream(track);
  }
}
