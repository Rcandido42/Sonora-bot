import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { SsrfValidationError, type Track, type TrackRequester } from '@sonora/shared';
import {
  DirectAudioAdapter,
  SoundCloudAdapter,
  SonoraAudioEngine,
  YouTubeAdapter,
  LyricsService,
  parseSyncedLrc,
  type AudioSourceAdapter,
  type PcmAudioStreamHandle
} from '../src/index.js';

class MockPcmAdapter implements AudioSourceAdapter {
  public readonly sourceType = 'youtube' as const;

  public canHandle(): boolean {
    return true;
  }

  public async resolveTrack(query: string, requester: TrackRequester | null): Promise<Track> {
    return {
      id: `mock-${query.toLowerCase().replace(/\s+/g, '-')}`,
      title: query,
      artist: 'Sonora Test Artist',
      durationMs: 210_000,
      artworkUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      source: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(query)}`,
      requestedBy: requester,
      addedAt: new Date().toISOString()
    };
  }

  public async createPcmStream(): Promise<PcmAudioStreamHandle> {
    const stream = new PassThrough();
    // Envia alguns frames PCM silenciosos (s16le 48kHz stereo)
    stream.write(Buffer.alloc(3840));
    return {
      stream,
      cleanup: () => {
        stream.destroy();
      }
    };
  }
}

describe('Fases 4 & 5 — SonoraAudioEngine, Adaptadores, Fila e Permissões de DJ', () => {
  it('routes queries accurately across DirectAudioAdapter, SoundCloudAdapter and YouTubeAdapter', async () => {
    const direct = new DirectAudioAdapter();
    const sc = new SoundCloudAdapter();
    const yt = new YouTubeAdapter();

    expect(direct.canHandle('https://cdn.example.com/music/theme.mp3')).toBe(true);
    expect(direct.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);

    expect(sc.canHandle('https://soundcloud.com/forss/flickermood')).toBe(true);
    expect(sc.canHandle('scsearch:flickermood')).toBe(true);
    expect(sc.canHandle('Daft Punk')).toBe(false);

    expect(yt.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(yt.canHandle('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(yt.canHandle('Daft Punk - Get Lucky')).toBe(true);

    // DirectAudioAdapter bloqueia SSRF para endereços privados
    await expect(
      direct.resolveTrack('https://127.0.0.1/secret.mp3', null)
    ).rejects.toThrow(SsrfValidationError);
  });

  it('connects to voice channel, plays PCM stream, manages queue, loop, shuffle and volume', async () => {
    const connectedTargets: string[] = [];
    const engine = new SonoraAudioEngine({
      adapters: [new MockPcmAdapter()],
      connectToVoiceFn: async (target) => {
        connectedTargets.push(target.id);
        return null;
      }
    });

    const guildId = '111222333444555666';
    const requester: TrackRequester = { id: 'u1', username: 'diogo' };

    // Primeira faixa entra no canal de voz e inicia reprodução imediata
    const first = await engine.play({
      guildId,
      query: 'Faixa 1',
      voiceChannel: { id: 'vc-100', name: 'Geral', guildId },
      textChannelId: 'tc-100',
      requester
    });

    expect(connectedTargets).toEqual(['vc-100']);
    expect(first.startedImmediately).toBe(true);
    expect(first.state.botConnected).toBe(true);
    expect(first.state.voiceChannelId).toBe('vc-100');
    expect(first.state.currentTrack?.title).toBe('Faixa 1');

    // Segunda e terceira faixas entram na fila
    await engine.play({
      guildId,
      query: 'Faixa 2',
      voiceChannel: { id: 'vc-100', name: 'Geral', guildId },
      textChannelId: 'tc-100',
      requester
    });
    await engine.play({
      guildId,
      query: 'Faixa 3',
      voiceChannel: { id: 'vc-100', name: 'Geral', guildId },
      textChannelId: 'tc-100',
      requester
    });

    expect(engine.getState(guildId).queue.map((t) => t.title)).toEqual(['Faixa 2', 'Faixa 3']);

    // Pausa, Retoma e Volume
    expect(engine.pause(guildId).status).toBe('paused');
    expect(engine.resume(guildId).status).toBe('playing');
    expect(engine.setVolume(guildId, 135).volume).toBe(135);

    // Loop de fila: ao fazer skip, a faixa atual volta para o fim da fila
    engine.setLoopMode(guildId, 'queue');
    const skipRes = engine.skip(guildId);
    expect(skipRes.skipped?.title).toBe('Faixa 1');
    expect(skipRes.next?.title).toBe('Faixa 2');
    expect(skipRes.state.queue.map((t) => t.title)).toEqual(['Faixa 3', 'Faixa 1']);

    // Remover faixa da fila
    const removed = engine.removeTrack(guildId, 2);
    expect(removed.removed.title).toBe('Faixa 1');
    expect(removed.state.queue).toHaveLength(1);

    // Limpar, Parar e Sair
    expect(engine.clearQueue(guildId).clearedCount).toBe(1);
    expect(engine.stop(guildId).currentTrack).toBeNull();
    expect(engine.leave(guildId).botConnected).toBe(false);
  });

  it('enforces DJ permissions accurately (admin, solo listener in voice, and DJ roles)', () => {
    const engine = new SonoraAudioEngine();
    const guildId = '111222333444555666';

    engine.setGuildDjConfig(guildId, true, ['role-dj-1']);

    // Utilizador comum com mais pessoas na call e sem cargo DJ -> negado
    expect(
      engine.hasDjPermission(guildId, {
        id: 'u2',
        isAdmin: false,
        roleIds: ['role-member'],
        voiceChannelUserCount: 3
      })
    ).toBe(false);

    // Utilizador sozinho no canal de voz com o bot -> permitido
    expect(
      engine.hasDjPermission(guildId, {
        id: 'u2',
        isAdmin: false,
        roleIds: ['role-member'],
        voiceChannelUserCount: 1
      })
    ).toBe(true);

    // Utilizador com cargo DJ -> permitido
    expect(
      engine.hasDjPermission(guildId, {
        id: 'u3',
        isAdmin: false,
        roleIds: ['role-dj-1'],
        voiceChannelUserCount: 4
      })
    ).toBe(true);

    // Administrador -> sempre permitido
    expect(
      engine.hasDjPermission(guildId, {
        id: 'u4',
        isAdmin: true,
        roleIds: [],
        voiceChannelUserCount: 5
      })
    ).toBe(true);
  });

  it('parses synced LRC lyrics and queries LyricsService', async () => {
    const synced = parseSyncedLrc('[00:12.50] Primeira linha\n[01:05.00] Segunda linha');
    expect(synced).toEqual([
      { timeMs: 12_500, text: 'Primeira linha' },
      { timeMs: 65_000, text: 'Segunda linha' }
    ]);

    const service = new LyricsService({
      fetchFn: (async () =>
        new Response(
          JSON.stringify([
            {
              trackName: 'Starlight',
              artistName: 'Muse',
              plainLyrics: 'Far away\nThis ship is taking me far away',
              syncedLyrics: '[00:15.00] Far away'
            }
          ]),
          { status: 200 }
        )) as typeof fetch
    });

    const res = await service.searchLyrics('Starlight', 'Muse');
    expect(res?.provider).toBe('lrclib');
    expect(res?.plainLyrics).toContain('Far away');
    expect(res?.syncedLyrics).toHaveLength(1);
  });
});
