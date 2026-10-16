import type { LyricsResult, SyncedLyricLine } from '@sonora/shared';

export interface LyricsServiceOptions {
  lrclibBaseUrl?: string;
  geniusAccessToken?: string;
  fetchFn?: typeof fetch;
}

interface LrclibSearchItem {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export function parseSyncedLrc(lrc: string | null | undefined): SyncedLyricLine[] | null {
  if (!lrc) return null;
  const lines: SyncedLyricLine[] = [];
  const regex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/;

  for (const rawLine of lrc.split(/\r?\n/)) {
    const match = rawLine.trim().match(regex);
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
    const text = match[4].trim();
    const timeMs = (minutes * 60 + seconds) * 1000 + fraction;
    lines.push({ timeMs, text });
  }

  return lines.length > 0 ? lines : null;
}

export class LyricsService {
  private readonly lrclibBaseUrl: string;
  private readonly geniusAccessToken: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: LyricsServiceOptions = {}) {
    this.lrclibBaseUrl = (options.lrclibBaseUrl ?? 'https://lrclib.net/api').replace(/\/+$/, '');
    this.geniusAccessToken = options.geniusAccessToken ?? '';
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async searchLyrics(query: string, artistHint = ''): Promise<LyricsResult | null> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return null;

    const searchParam = artistHint ? `${cleanQuery} ${artistHint}` : cleanQuery;
    const url = `${this.lrclibBaseUrl}/search?q=${encodeURIComponent(searchParam)}`;

    try {
      const response = await this.fetchFn(url, {
        headers: {
          'User-Agent': 'Sonora/1.0.0 (Discord Music Bot & Web Player)'
        }
      });

      if (response.ok) {
        const items = (await response.json()) as LrclibSearchItem[];
        if (Array.isArray(items) && items.length > 0) {
          const withLyrics = items.find((i) => i.plainLyrics || i.syncedLyrics) ?? items[0];
          const plain = withLyrics.plainLyrics?.trim() ?? null;
          const synced = parseSyncedLrc(withLyrics.syncedLyrics);

          if (plain || synced) {
            return {
              trackTitle: withLyrics.trackName ?? withLyrics.name ?? cleanQuery,
              artistName: withLyrics.artistName ?? artistHint,
              provider: 'lrclib',
              plainLyrics: plain,
              syncedLyrics: synced,
              externalUrl: `https://lrclib.net/search?q=${encodeURIComponent(searchParam)}`,
              isTruncated: Boolean(plain && plain.length > 3800),
              copyrightNotice: 'LRCLIB • Direitos reservados aos respetivos autores e editoras.'
            };
          }
        }
      }
    } catch {
      // Continua para fallback autorizado
    }

    if (this.geniusAccessToken) {
      try {
        const geniusRes = await this.fetchFn(
          `https://api.genius.com/search?q=${encodeURIComponent(searchParam)}`,
          {
            headers: {
              Authorization: `Bearer ${this.geniusAccessToken}`,
              'User-Agent': 'Sonora/1.0.0'
            }
          }
        );
        if (geniusRes.ok) {
          const data = (await geniusRes.json()) as {
            response?: {
              hits?: Array<{
                result?: {
                  title?: string;
                  primary_artist?: { name?: string };
                  url?: string;
                };
              }>;
            };
          };
          const hit = data.response?.hits?.[0]?.result;
          if (hit?.url) {
            return {
              trackTitle: hit.title ?? cleanQuery,
              artistName: hit.primary_artist?.name ?? artistHint,
              provider: 'genius',
              plainLyrics: null,
              syncedLyrics: null,
              externalUrl: hit.url,
              isTruncated: false,
              copyrightNotice: 'Genius • Apresentação direta restrita por direitos de autor.'
            };
          }
        }
      } catch {
        // Ignorado
      }
    }

    return null;
  }
}
