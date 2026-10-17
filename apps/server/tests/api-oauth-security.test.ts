import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SonoraDatabase } from '@sonora/database';
import { SonoraAudioEngine } from '@sonora/audio-engine';
import type { AppConfig } from '@sonora/shared';
import { RealAudioPlaybackPort } from '../src/bot/real-playback-port.js';
import { createSonoraApiServer } from '../src/api/server.js';
import { SONORA_OAUTH_STATE_COOKIE, SONORA_SESSION_COOKIE } from '../src/api/auth.js';

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  DEFAULT_LANGUAGE: 'pt-PT',
  LOG_LEVEL: 'error',
  DISCORD_TOKEN: 'test_token_12345678901234567890',
  DISCORD_CLIENT_ID: '1560698548566364162',
  DISCORD_GUILD_ID: '999888777666555444',
  DISCORD_CLIENT_SECRET: 'test_client_secret_1234567890',
  OAUTH_REDIRECT_URI: 'http://localhost:3001/api/auth/callback',
  SESSION_SECRET: 'super_secret_session_key_minimum_32_characters_long_sonora',
  SESSION_TTL_SECONDS: 604800,
  HOST: '127.0.0.1',
  PORT: 3001,
  PUBLIC_WEB_URL: 'http://localhost:5173',
  TRUST_PROXY: false,
  DATABASE_PATH: './data/test.sqlite',
  BACKUP_DIR: './backups',
  SPOTIFY_CLIENT_ID: '',
  SPOTIFY_CLIENT_SECRET: '',
  GENIUS_ACCESS_TOKEN: '',
  LRCLIB_API_URL: 'https://lrclib.net/api',
  FFMPEG_PATH: '',
  YTDLP_PATH: '',
  ALLOW_INSECURE_DIRECT_AUDIO_HTTP: false
};

const SAMPLE_PERSISTABLE_TRACK = {
  id: 'yt:dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  durationMs: 213000,
  artworkUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  source: 'youtube' as const,
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
};

function extractSignedCookieValue(
  setCookieHeaders: string | string[] | undefined,
  name: string
): string | null {
  if (!setCookieHeaders) return null;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const header of list) {
    const match = header.match(new RegExp(`^${name}=([^;]+)`));
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

describe('Sonora Fastify API, Discord OAuth2, CSRF & Security', () => {
  let tempDir: string;
  let database: SonoraDatabase;
  let engine: SonoraAudioEngine;
  let playback: RealAudioPlaybackPort;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-api-test-'));
    database = new SonoraDatabase(path.join(tempDir, 'sonora.sqlite'));
    engine = new SonoraAudioEngine({
      defaultLocale: 'pt-PT'
    });
    playback = new RealAudioPlaybackPort(TEST_CONFIG, {
      engine,
      database
    });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('expõe /api/health com cabeçalhos de segurança Helmet e identidade Sonora', async () => {
    const app = await createSonoraApiServer({
      config: TEST_CONFIG,
      playback,
      database
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.brand).toBe('Sonora');
    expect(body.databaseIntegrity).toBe(true);

    await app.close();
  });

  it('valida o fluxo OAuth2 completo: state cookie, pertença ao servidor Discord e criação de sessão HttpOnly', async () => {
    let userGuildsMembership = true;

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/oauth2/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock_discord_access_token',
            token_type: 'Bearer',
            expires_in: 604800,
            scope: 'identify guilds'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.endsWith('/users/@me')) {
        return new Response(
          JSON.stringify({
            id: '111222333444555666',
            username: 'TesterDJ',
            global_name: 'Tester DJ',
            avatar: null
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.endsWith(`/users/@me/guilds/${TEST_CONFIG.DISCORD_GUILD_ID}/member`)) {
        if (!userGuildsMembership) {
          return new Response(JSON.stringify({ message: 'Unknown Member' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }
        return new Response(
          JSON.stringify({
            roles: ['777888999000111222'],
            permissions: String(0x8) // Administrator
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const app = await createSonoraApiServer({
      config: TEST_CONFIG,
      playback,
      database,
      fetchFn: mockFetch
    });

    // 1. Iniciar login OAuth2 para obter o cookie state assinado
    const loginRes = await app.inject({
      method: 'GET',
      url: '/api/auth/login'
    });
    expect(loginRes.statusCode).toBe(302);
    const location = loginRes.headers.location as string;
    expect(location).toContain('https://discord.com/oauth2/authorize');

    const signedStateCookie = extractSignedCookieValue(
      loginRes.headers['set-cookie'],
      SONORA_OAUTH_STATE_COOKIE
    );
    expect(signedStateCookie).toBeTruthy();

    // 2. Tentar callback com state adulterado -> deve rejeitar com 403
    const badStateRes = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=valid_code&state=wrong_state`,
      cookies: {
        [SONORA_OAUTH_STATE_COOKIE]: signedStateCookie!
      }
    });
    expect(badStateRes.statusCode).toBe(403);
    expect(badStateRes.json().error).toBe('OAUTH_STATE_MISMATCH');

    // 3. Tentar callback quando o utilizador NÃO pertence ao servidor Discord configurado -> deve rejeitar com 403
    userGuildsMembership = false;
    const loginRes2 = await app.inject({
      method: 'GET',
      url: '/api/auth/login'
    });
    const stateParam2 = new URL(loginRes2.headers.location as string).searchParams.get('state')!;
    const signedStateCookie2 = extractSignedCookieValue(
      loginRes2.headers['set-cookie'],
      SONORA_OAUTH_STATE_COOKIE
    )!;

    const nonMemberRes = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=valid_code&state=${stateParam2}`,
      cookies: {
        [SONORA_OAUTH_STATE_COOKIE]: signedStateCookie2
      }
    });
    expect(nonMemberRes.statusCode).toBe(403);
    expect(nonMemberRes.json().error).toBe('OAUTH_CALLBACK_FAILED');

    // 4. Callback válido com membro do servidor -> cria sessão e redireciona para o painel web
    userGuildsMembership = true;
    const loginRes3 = await app.inject({
      method: 'GET',
      url: '/api/auth/login'
    });
    const stateParam3 = new URL(loginRes3.headers.location as string).searchParams.get('state')!;
    const signedStateCookie3 = extractSignedCookieValue(
      loginRes3.headers['set-cookie'],
      SONORA_OAUTH_STATE_COOKIE
    )!;

    const validCallbackRes = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=valid_code&state=${stateParam3}`,
      cookies: {
        [SONORA_OAUTH_STATE_COOKIE]: signedStateCookie3
      }
    });
    expect(validCallbackRes.statusCode).toBe(302);
    expect(validCallbackRes.headers.location).toBe('http://localhost:5173');

    const sessionCookie = extractSignedCookieValue(
      validCallbackRes.headers['set-cookie'],
      SONORA_SESSION_COOKIE
    );
    expect(sessionCookie).toBeTruthy();

    // 5. Consultar /api/auth/me com o cookie de sessão
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: {
        [SONORA_SESSION_COOKIE]: sessionCookie!
      }
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json();
    expect(meBody.authenticated).toBe(true);
    expect(meBody.user.username).toBe('TesterDJ');
    expect(meBody.user.isAdmin).toBe(true);
    expect(meBody.csrfToken).toBeTruthy();

    await app.close();
  });

  it('bloqueia mutações sem token CSRF válido e sincroniza controlos do player, favoritos e playlists', async () => {
    const app = await createSonoraApiServer({
      config: TEST_CONFIG,
      playback,
      database
    });

    const session = database.createSession({
      sessionId: 'session_test_1234567890_abcdef_123456',
      userId: '111222333444555666',
      username: 'TesterDJ',
      displayName: 'Tester DJ',
      avatarUrl: null,
      guildId: TEST_CONFIG.DISCORD_GUILD_ID,
      isAdmin: false,
      isDj: false,
      roleIds: [],
      csrfToken: 'csrf_token_test_1234567890_abcdef',
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    const signedSessionCookie = app.signCookie(session.sessionId);

    // 1. Tentar alterar volume SEM cabeçalho X-CSRF-Token -> 403 Forbidden
    const noCsrfRes = await app.inject({
      method: 'POST',
      url: '/api/player/volume',
      cookies: {
        [SONORA_SESSION_COOKIE]: signedSessionCookie
      },
      payload: { volume: 120 }
    });
    expect(noCsrfRes.statusCode).toBe(403);
    expect(noCsrfRes.json().error).toBe('CSRF_INVALID');

    // 2. Alterar volume COM X-CSRF-Token válido -> 200 OK e atualiza o motor de áudio
    const volumeRes = await app.inject({
      method: 'POST',
      url: '/api/player/volume',
      cookies: {
        [SONORA_SESSION_COOKIE]: signedSessionCookie
      },
      headers: {
        'x-csrf-token': session.csrfToken
      },
      payload: { volume: 135 }
    });
    expect(volumeRes.statusCode).toBe(200);
    expect(volumeRes.json().volume).toBe(135);

    // 3. Ativar modo DJ-only e verificar que utilizador não-DJ recebe 403 ao controlar o player
    database.updateGuildSettings(TEST_CONFIG.DISCORD_GUILD_ID, {
      djOnlyMode: true
    });
    playback.engine.setGuildDjConfig(TEST_CONFIG.DISCORD_GUILD_ID, true, []);

    const djBlockedRes = await app.inject({
      method: 'POST',
      url: '/api/player/volume',
      cookies: {
        [SONORA_SESSION_COOKIE]: signedSessionCookie
      },
      headers: {
        'x-csrf-token': session.csrfToken
      },
      payload: { volume: 80 }
    });
    expect(djBlockedRes.statusCode).toBe(403);
    expect(djBlockedRes.json().error).toBe('DJ_PERMISSION_REQUIRED');

    // 4. Testar Favoritos e Playlists Pessoais via API
    const addFavRes = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: {
        [SONORA_SESSION_COOKIE]: signedSessionCookie
      },
      headers: {
        'x-csrf-token': session.csrfToken
      },
      payload: SAMPLE_PERSISTABLE_TRACK
    });
    expect(addFavRes.statusCode).toBe(200);
    expect(addFavRes.json().item.title).toBe('Never Gonna Give You Up');

    const createPlaylistRes = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      cookies: {
        [SONORA_SESSION_COOKIE]: signedSessionCookie
      },
      headers: {
        'x-csrf-token': session.csrfToken
      },
      payload: {
        name: 'Noites Synthwave',
        description: 'Playlist criada no teste da API'
      }
    });
    expect(createPlaylistRes.statusCode).toBe(200);
    const playlistId = createPlaylistRes.json().playlist.id as number;

    const addTrackToPlaylistRes = await app.inject({
      method: 'POST',
      url: `/api/playlists/${playlistId}/tracks`,
      cookies: {
        [SONORA_SESSION_COOKIE]: signedSessionCookie
      },
      headers: {
        'x-csrf-token': session.csrfToken
      },
      payload: SAMPLE_PERSISTABLE_TRACK
    });
    expect(addTrackToPlaylistRes.statusCode).toBe(200);
    expect(addTrackToPlaylistRes.json().playlist.tracks).toHaveLength(1);

    await app.close();
  });
});
