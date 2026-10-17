import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import type { Client, VoiceBasedChannel } from 'discord.js';
import {
  logger,
  SONORA_BRAND,
  type AppConfig,
  type LoopMode,
  type SupportedLocale,
  type WebSocketEventMessage
} from '@sonora/shared';
import type { SonoraDatabase, WebSessionRecord } from '@sonora/database';
import type { RealAudioPlaybackPort } from '../bot/real-playback-port.js';
import {
  SONORA_OAUTH_STATE_COOKIE,
  SONORA_SESSION_COOKIE,
  authenticateDiscordOAuthCallback,
  buildDiscordOAuthAuthorizeUrl,
  generateRandomToken,
  mapSessionToAuthenticatedUser,
  resolveEffectiveGuildId,
  verifyCsrfToken
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '../../../web/dist');

export interface SonoraApiServerOptions {
  config: AppConfig;
  playback: RealAudioPlaybackPort;
  database: SonoraDatabase;
  botClient?: Client | null;
  fetchFn?: typeof fetch;
}

declare module 'fastify' {
  interface FastifyRequest {
    sonoraSession?: WebSessionRecord;
  }
}

export async function createSonoraApiServer(
  options: SonoraApiServerOptions
): Promise<FastifyInstance> {
  const { config, playback, database, botClient, fetchFn } = options;

  const isHttps =
    config.NODE_ENV === 'production' || config.PUBLIC_WEB_URL.startsWith('https://');

  const app = Fastify({
    logger: false,
    trustProxy: config.TRUST_PROXY
  });

  // 1. Cabeçalhos de Segurança HTTP (Helmet)
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  });

  // 2. Política CORS Restrita
  const allowedOrigins = new Set<string>([
    config.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    `http://localhost:${config.PORT}`,
    `http://127.0.0.1:${config.PORT}`
  ]);

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ''))) {
        cb(null, true);
        return;
      }
      cb(new Error('Origem não autorizada pela política CORS da Sonora.'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
  });

  // 3. Cookies Assinados e Seguros
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
    hook: 'onRequest'
  });

  // 4. Rate Limiting Global
  await app.register(fastifyRateLimit, {
    max: 180,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Limite de pedidos excedido. Aguarda alguns segundos antes de tentar novamente.'
    })
  });

  // 5. WebSockets em Tempo Real
  await app.register(fastifyWebsocket);

  const wsClients = new Set<{ send: (data: string) => void; readyState: number }>();

  const broadcastWs = (msg: WebSocketEventMessage) => {
    const serialized = JSON.stringify(msg);
    for (const client of wsClients) {
      if (client.readyState === 1) {
        try {
          client.send(serialized);
        } catch {
          // Ignorado
        }
      }
    }
  };

  playback.engine.on('stateChanged', (stateSnapshot) => {
    broadcastWs({ type: 'player:state', payload: stateSnapshot });
  });

  playback.engine.on('trackStarted', ({ guildId }: { guildId: string }) => {
    broadcastWs({
      type: 'history:updated',
      payload: database.getHistory(guildId, 40)
    });
  });

  const getSessionFromRequest = (req: FastifyRequest): WebSessionRecord | null => {
    const rawCookie = req.cookies[SONORA_SESSION_COOKIE];
    if (!rawCookie) return null;
    const unsigned = req.unsignCookie(rawCookie);
    if (!unsigned.valid || !unsigned.value) return null;
    return database.getSession(unsigned.value);
  };

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Sessão inválida ou expirada. Inicia sessão com o Discord.'
      });
    }
    req.sonoraSession = session;

    // Validação CSRF obrigatória em todas as operações de escrita/mutação
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      const csrfHeader = req.headers['x-csrf-token'];
      const providedToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!verifyCsrfToken(session.csrfToken, providedToken)) {
        return reply.code(403).send({
          error: 'CSRF_INVALID',
          message: 'Token CSRF inválido ou em falta.'
        });
      }
    }
  };

  const resolveVoiceChannelForWebPlay = (
    guildId: string,
    userId: string
  ): { id: string; name: string; guildId: string; adapterCreator?: VoiceBasedChannel['guild']['voiceAdapterCreator'] } | null => {
    const state = playback.getState(guildId);
    const guild = botClient?.guilds?.cache?.get(guildId) ?? botClient?.guilds?.cache?.first();

    if (guild) {
      // 1. Verifica se o utilizador autenticado está num canal de voz
      const member = guild.members.cache.get(userId);
      if (member?.voice?.channel) {
        return {
          id: member.voice.channel.id,
          name: member.voice.channel.name,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator
        };
      }

      // 2. Se o bot já está ligado a um canal de voz neste servidor
      if (state.voiceChannelId) {
        const existingChannel = guild.channels.cache.get(state.voiceChannelId);
        if (existingChannel?.isVoiceBased()) {
          return {
            id: existingChannel.id,
            name: existingChannel.name,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator
          };
        }
      }

      // 3. Procura qualquer canal de voz no servidor que tenha membros humanos ativos
      for (const channel of guild.channels.cache.values()) {
        if (channel.isVoiceBased() && channel.members.some((m) => !m.user.bot)) {
          return {
            id: channel.id,
            name: channel.name,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator
          };
        }
      }
    }

    if (state.voiceChannelId) {
      return {
        id: state.voiceChannelId,
        name: state.voiceChannelName ?? 'Voice Channel',
        guildId
      };
    }

    return null;
  };

  // ===========================================================================
  // Rotas de Estado e Autenticação OAuth2
  // ===========================================================================

  app.get('/api/health', async () => {
    const guildId = resolveEffectiveGuildId(config, botClient);
    const guild = botClient?.guilds?.cache?.get(guildId) ?? botClient?.guilds?.cache?.first();
    return {
      status: 'ok',
      brand: SONORA_BRAND.name,
      botReady: Boolean(botClient?.isReady()),
      botTag: botClient?.user?.tag ?? null,
      guildId,
      guildName: guild?.name ?? 'Servidor Sonora',
      databaseIntegrity: database.checkIntegrity(),
      oauthConfigured: Boolean(config.DISCORD_CLIENT_SECRET),
      devLoginAvailable: config.NODE_ENV !== 'production'
    };
  });

  app.get('/api/auth/login', async (_req, reply) => {
    if (!config.DISCORD_CLIENT_SECRET) {
      return reply.code(400).send({
        error: 'OAUTH_SECRET_MISSING',
        message:
          'Para iniciar sessão via Discord OAuth2, preenche DISCORD_CLIENT_SECRET no ficheiro .env (ou utiliza o acesso local de desenvolvimento).'
      });
    }

    const state = generateRandomToken(24);
    reply.setCookie(SONORA_OAUTH_STATE_COOKIE, state, {
      path: '/',
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 300
    });

    const redirectUrl = buildDiscordOAuthAuthorizeUrl(config, state);
    return reply.redirect(redirectUrl);
  });

  app.get('/api/auth/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string };
    const rawStateCookie = req.cookies[SONORA_OAUTH_STATE_COOKIE];
    reply.clearCookie(SONORA_OAUTH_STATE_COOKIE, { path: '/' });

    if (!query.code || !query.state || !rawStateCookie) {
      return reply.code(400).send({
        error: 'INVALID_OAUTH_STATE',
        message: 'Parâmetros OAuth2 ou cookie state em falta.'
      });
    }

    const unsignedState = req.unsignCookie(rawStateCookie);
    if (!unsignedState.valid || unsignedState.value !== query.state) {
      return reply.code(403).send({
        error: 'OAUTH_STATE_MISMATCH',
        message: 'Validação do parâmetro state OAuth2 falhou (possível tentativa de CSRF).'
      });
    }

    try {
      const profile = await authenticateDiscordOAuthCallback({
        config,
        code: query.code,
        database,
        botClient,
        fetchFn
      });

      const sessionId = generateRandomToken(32);
      const csrfToken = generateRandomToken(32);
      const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000).toISOString();

      database.createSession({
        sessionId,
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        guildId: profile.guildId,
        isAdmin: profile.isAdmin,
        isDj: profile.isDj,
        roleIds: profile.roleIds,
        csrfToken,
        expiresAt
      });

      reply.setCookie(SONORA_SESSION_COOKIE, sessionId, {
        path: '/',
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: config.SESSION_TTL_SECONDS
      });

      return reply.redirect(config.PUBLIC_WEB_URL);
    } catch (err) {
      const statusCode =
        err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
          ? err.statusCode
          : 400;
      const message = err instanceof Error ? err.message : 'Falha na autenticação Discord OAuth2.';
      logger.warn({ err: message }, '[Sonora OAuth2] Falha no callback OAuth2');
      return reply.code(statusCode).send({
        error: 'OAUTH_CALLBACK_FAILED',
        message
      });
    }
  });

  // Sessão local rápida apenas em ambiente de desenvolvimento no PC local
  app.post('/api/auth/dev-login', async (req, reply) => {
    if (config.NODE_ENV === 'production') {
      return reply.code(403).send({
        error: 'FORBIDDEN_IN_PRODUCTION',
        message: 'O login rápido de desenvolvimento está desativado em produção.'
      });
    }

    const body = (req.body ?? {}) as { username?: string };
    const guildId = resolveEffectiveGuildId(config, botClient);
    const sessionId = generateRandomToken(32);
    const csrfToken = generateRandomToken(32);
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000).toISOString();

    database.createSession({
      sessionId,
      userId: 'local-admin',
      username: body.username?.trim() || 'admin',
      displayName: body.username?.trim() || 'Administrador Local',
      avatarUrl: null,
      guildId,
      isAdmin: true,
      isDj: true,
      roleIds: [],
      csrfToken,
      expiresAt
    });

    reply.setCookie(SONORA_SESSION_COOKIE, sessionId, {
      path: '/',
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: config.SESSION_TTL_SECONDS
    });

    const created = database.getSession(sessionId)!;
    return {
      user: mapSessionToAuthenticatedUser(created, database),
      csrfToken
    };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      return reply.code(401).send({
        authenticated: false,
        oauthConfigured: Boolean(config.DISCORD_CLIENT_SECRET),
        devLoginAvailable: config.NODE_ENV !== 'production'
      });
    }

    return {
      authenticated: true,
      user: mapSessionToAuthenticatedUser(session, database),
      csrfToken: session.csrfToken,
      oauthConfigured: Boolean(config.DISCORD_CLIENT_SECRET)
    };
  });

  app.post('/api/auth/logout', { preHandler: [requireAuth] }, async (req, reply) => {
    if (req.sonoraSession) {
      database.deleteSession(req.sonoraSession.sessionId);
    }
    reply.clearCookie(SONORA_SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ===========================================================================
  // WebSocket em Tempo Real (/ws)
  // ===========================================================================

  app.get('/ws', { websocket: true }, (socket, req) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    wsClients.add(socket);
    const guildId = session.guildId;

    // Envia estado inicial imediatamente após ligação
    socket.send(
      JSON.stringify({
        type: 'player:state',
        payload: playback.getState(guildId)
      } satisfies WebSocketEventMessage)
    );

    socket.on('close', () => {
      wsClients.delete(socket);
    });
  });

  // ===========================================================================
  // Rotas de Controlo do Leitor e Fila
  // ===========================================================================

  app.get('/api/player/state', { preHandler: [requireAuth] }, async (req) => {
    const guildId = req.sonoraSession!.guildId;
    return playback.getState(guildId);
  });

  app.post('/api/player/play', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    const body = (req.body ?? {}) as { query?: string };
    const query = body.query?.trim();
    if (!query) {
      return reply.code(400).send({
        error: 'INVALID_QUERY',
        message: 'Indica o nome da música, artista ou URL para reproduzir.'
      });
    }

    const voiceTarget = resolveVoiceChannelForWebPlay(session.guildId, session.userId);
    if (!voiceTarget) {
      return reply.code(400).send({
        error: 'NO_ACTIVE_VOICE_CHANNEL',
        message:
          'Entra primeiro num canal de voz no servidor Discord para a Sonora se ligar automaticamente.'
      });
    }

    const result = await playback.engine.play({
      guildId: session.guildId,
      query,
      voiceChannel: voiceTarget,
      textChannelId: playback.getState(session.guildId).textChannelId ?? '',
      requester: {
        id: session.userId,
        username: session.username,
        displayName: session.displayName,
        avatarUrl: session.avatarUrl
      }
    });

    return result;
  });

  const ensureWebDjPermission = (session: WebSessionRecord, reply: FastifyReply): boolean => {
    const state = playback.getState(session.guildId);
    const isRequester = state.currentTrack?.requestedBy?.id === session.userId;
    const allowed =
      isRequester ||
      playback.hasDjPermission(session.guildId, {
        id: session.userId,
        isAdmin: session.isAdmin,
        roleIds: session.roleIds
      });

    if (!allowed) {
      reply.code(403).send({
        error: 'DJ_PERMISSION_REQUIRED',
        message: 'Apenas utilizadores com cargo de DJ ou Administradores podem executar esta ação.'
      });
      return false;
    }
    return true;
  };

  app.post('/api/player/pause', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.pause(session.guildId);
  });

  app.post('/api/player/resume', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.resume(session.guildId);
  });

  app.post('/api/player/skip', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.skip(session.guildId);
  });

  app.post('/api/player/stop', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.stop(session.guildId);
  });

  app.post('/api/player/leave', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.leave(session.guildId);
  });

  app.post('/api/player/volume', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    const body = (req.body ?? {}) as { volume?: number };
    if (typeof body.volume !== 'number' || body.volume < 0 || body.volume > 200) {
      return reply.code(400).send({
        error: 'INVALID_VOLUME',
        message: 'O volume deve estar entre 0 e 200.'
      });
    }
    return playback.setVolume(session.guildId, body.volume);
  });

  app.post('/api/player/loop', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    const body = (req.body ?? {}) as { mode?: LoopMode };
    if (!body.mode || !['off', 'track', 'queue'].includes(body.mode)) {
      return reply.code(400).send({
        error: 'INVALID_LOOP_MODE',
        message: 'Modo de repetição inválido.'
      });
    }
    return playback.setLoopMode(session.guildId, body.mode);
  });

  app.post('/api/player/shuffle', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.shuffleQueue(session.guildId);
  });

  app.post('/api/player/clear', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    return playback.clearQueue(session.guildId);
  });

  app.delete('/api/player/queue/:position', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!ensureWebDjPermission(session, reply)) return;
    const params = req.params as { position?: string };
    const pos = Number(params.position);
    if (!Number.isInteger(pos) || pos < 1) {
      return reply.code(400).send({ error: 'INVALID_POSITION', message: 'Posição inválida.' });
    }
    try {
      return playback.removeTrack(session.guildId, pos);
    } catch {
      return reply.code(400).send({ error: 'INVALID_POSITION', message: 'Posição fora da fila.' });
    }
  });

  // ===========================================================================
  // Letras, Favoritos, Playlists, Histórico e Configurações
  // ===========================================================================

  app.get('/api/lyrics', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const query = (req.query as { q?: string }).q;
    const res = await playback.getLyrics(session.guildId, query);
    return { lyrics: res };
  });

  app.get('/api/favorites', { preHandler: [requireAuth] }, async (req) => {
    return { favorites: database.getFavorites(req.sonoraSession!.userId) };
  });

  app.post('/api/favorites', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const track = req.body as Parameters<SonoraDatabase['addFavorite']>[1];
    return database.addFavorite(session.userId, track);
  });

  app.delete('/api/favorites/:trackId', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const { trackId } = req.params as { trackId: string };
    return { removed: database.removeFavorite(session.userId, decodeURIComponent(trackId)) };
  });

  app.get('/api/playlists', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    return { playlists: database.getPlaylistsByUser(session.userId, session.guildId) };
  });

  app.get('/api/playlists/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    const id = Number((req.params as { id: string }).id);
    const playlist = database.getPlaylistById(id, session.userId);
    if (!playlist) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Playlist não encontrada.' });
    }
    return { playlist };
  });

  app.post('/api/playlists', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const body = req.body as { name: string; description?: string | null };
    const playlist = database.createPlaylist({
      userId: session.userId,
      guildId: session.guildId,
      name: body.name,
      description: body.description ?? null
    });
    return { playlist };
  });

  app.put('/api/playlists/:id', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { name: string; description?: string | null };
    const playlist = database.updatePlaylist(id, session.userId, body);
    return { playlist };
  });

  app.delete('/api/playlists/:id', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const id = Number((req.params as { id: string }).id);
    return { deleted: database.deletePlaylist(id, session.userId) };
  });

  app.post('/api/playlists/:id/tracks', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const id = Number((req.params as { id: string }).id);
    const track = req.body as Parameters<SonoraDatabase['addTrackToPlaylist']>[2];
    const item = database.addTrackToPlaylist(id, session.userId, track);
    return { item, playlist: database.getPlaylistById(id, session.userId) };
  });

  app.delete('/api/playlists/:id/tracks/:itemId', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const params = req.params as { id: string; itemId: string };
    const removed = database.removeTrackFromPlaylist(
      Number(params.id),
      session.userId,
      Number(params.itemId)
    );
    return {
      removed,
      playlist: database.getPlaylistById(Number(params.id), session.userId)
    };
  });

  app.post('/api/playlists/:id/play', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    const id = Number((req.params as { id: string }).id);
    const playlist = database.getPlaylistById(id, session.userId);
    if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
      return reply.code(400).send({
        error: 'EMPTY_PLAYLIST',
        message: 'Esta playlist não contém faixas para reproduzir.'
      });
    }

    const voiceTarget = resolveVoiceChannelForWebPlay(session.guildId, session.userId);
    if (!voiceTarget) {
      return reply.code(400).send({
        error: 'NO_ACTIVE_VOICE_CHANNEL',
        message: 'Entra primeiro num canal de voz no Discord para reproduzir a playlist.'
      });
    }

    for (const item of playlist.tracks) {
      await playback.engine.play({
        guildId: session.guildId,
        query: item.sourceUrl,
        voiceChannel: voiceTarget,
        textChannelId: playback.getState(session.guildId).textChannelId ?? '',
        requester: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName,
          avatarUrl: session.avatarUrl
        }
      });
    }

    return {
      queuedCount: playlist.tracks.length,
      state: playback.getState(session.guildId)
    };
  });

  app.get('/api/history', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    return { history: database.getHistory(session.guildId, 50) };
  });

  app.delete('/api/history', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!session.isAdmin) {
      return reply.code(403).send({
        error: 'ADMIN_REQUIRED',
        message: 'Apenas Administradores podem limpar o histórico do servidor.'
      });
    }
    const cleared = database.clearHistory(session.guildId);
    broadcastWs({ type: 'history:updated', payload: [] });
    return { cleared };
  });

  app.get('/api/settings', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const guild = botClient?.guilds?.cache?.get(session.guildId);
    const availableRoles = guild
      ? Array.from(guild.roles.cache.values())
          .filter((r) => r.name !== '@everyone' && !r.managed)
          .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }))
      : [];

    return {
      settings: database.getGuildSettings(session.guildId),
      djRoles: database.getDjRoles(session.guildId),
      availableRoles
    };
  });

  app.put('/api/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!session.isAdmin) {
      return reply.code(403).send({
        error: 'ADMIN_REQUIRED',
        message: 'Apenas Administradores podem alterar as configurações do servidor.'
      });
    }
    const body = req.body as Parameters<SonoraDatabase['updateGuildSettings']>[1];
    const settings = database.updateGuildSettings(session.guildId, body);
    const djRoles = database.getDjRoles(session.guildId);

    playback.engine.setGuildLocale(session.guildId, settings.language);
    playback.engine.setGuildDjConfig(
      session.guildId,
      settings.djOnlyMode,
      djRoles.map((r) => r.roleId)
    );

    broadcastWs({ type: 'settings:updated', payload: { settings, djRoles } });
    return { settings, djRoles };
  });

  app.post('/api/settings/dj-roles', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!session.isAdmin) {
      return reply.code(403).send({
        error: 'ADMIN_REQUIRED',
        message: 'Apenas Administradores podem adicionar cargos de DJ.'
      });
    }
    const body = req.body as { roleId: string; roleName: string };
    const djRoles = database.addDjRole(session.guildId, body.roleId, body.roleName);
    const settings = database.getGuildSettings(session.guildId);
    playback.engine.setGuildDjConfig(
      session.guildId,
      settings.djOnlyMode,
      djRoles.map((r) => r.roleId)
    );
    broadcastWs({ type: 'settings:updated', payload: { settings, djRoles } });
    return { djRoles };
  });

  app.delete('/api/settings/dj-roles/:roleId', { preHandler: [requireAuth] }, async (req, reply) => {
    const session = req.sonoraSession!;
    if (!session.isAdmin) {
      return reply.code(403).send({
        error: 'ADMIN_REQUIRED',
        message: 'Apenas Administradores podem remover cargos de DJ.'
      });
    }
    const { roleId } = req.params as { roleId: string };
    const djRoles = database.removeDjRole(session.guildId, roleId);
    const settings = database.getGuildSettings(session.guildId);
    playback.engine.setGuildDjConfig(
      session.guildId,
      settings.djOnlyMode,
      djRoles.map((r) => r.roleId)
    );
    broadcastWs({ type: 'settings:updated', payload: { settings, djRoles } });
    return { djRoles };
  });

  app.put('/api/user/language', { preHandler: [requireAuth] }, async (req) => {
    const session = req.sonoraSession!;
    const body = req.body as { language: SupportedLocale };
    const language = database.setUserLanguage(session.userId, body.language);
    return { language };
  });

  // Servidor de ficheiros estáticos do Painel Web Sonora quando compilado (produção / acesso remoto)
  if (fs.existsSync(webDistDir)) {
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.json': 'application/json; charset=utf-8',
      '.ico': 'image/x-icon'
    };

    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      const cleanPath = req.url.split('?')[0].replace(/^\/+/, '') || 'index.html';
      const candidate = path.resolve(webDistDir, cleanPath);
      const targetFile =
        candidate.startsWith(webDistDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
          ? candidate
          : path.join(webDistDir, 'index.html');

      if (!fs.existsSync(targetFile)) {
        return reply.code(404).send({ error: 'WEB_BUILD_NOT_FOUND' });
      }

      const ext = path.extname(targetFile).toLowerCase();
      reply.type(mimeTypes[ext] ?? 'application/octet-stream');
      return fs.readFileSync(targetFile);
    });
  }

  return app;
}
