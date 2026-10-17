import crypto from 'node:crypto';
import { PermissionFlagsBits, type Client } from 'discord.js';
import type { AppConfig, AuthenticatedUser } from '@sonora/shared';
import type { SonoraDatabase, WebSessionRecord } from '@sonora/database';

export const SONORA_SESSION_COOKIE = 'sonora_session';
export const SONORA_OAUTH_STATE_COOKIE = 'sonora_oauth_state';

export function generateRandomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function verifyCsrfToken(expected: string, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const bufA = Buffer.from(expected, 'utf8');
  const bufB = Buffer.from(provided, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function resolveEffectiveGuildId(config: AppConfig, botClient?: Client | null): string {
  if (config.DISCORD_GUILD_ID && config.DISCORD_GUILD_ID !== '000000000000000000') {
    return config.DISCORD_GUILD_ID;
  }
  const firstGuild = botClient?.guilds?.cache?.first();
  return firstGuild?.id ?? config.DISCORD_GUILD_ID;
}

export function buildDiscordOAuthAuthorizeUrl(config: AppConfig, state: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', config.OAUTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds guilds.members.read');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');
  return url.toString();
}

export interface DiscordOAuthProfileResult {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  guildId: string;
  isAdmin: boolean;
  isDj: boolean;
  roleIds: string[];
}

export async function authenticateDiscordOAuthCallback(params: {
  config: AppConfig;
  code: string;
  database: SonoraDatabase;
  botClient?: Client | null;
  fetchFn?: typeof fetch;
}): Promise<DiscordOAuthProfileResult> {
  const { config, code, database, botClient } = params;
  const fetchImpl = params.fetchFn ?? fetch;

  if (!config.DISCORD_CLIENT_SECRET) {
    throw new Error('DISCORD_CLIENT_SECRET não está configurado no servidor.');
  }

  // 1. Troca authorization code por access_token
  const tokenBody = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.OAUTH_REDIRECT_URI
  });

  const tokenRes = await fetchImpl('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: tokenBody.toString()
  });

  if (!tokenRes.ok) {
    throw new Error(`Falha ao validar código OAuth2 no Discord (${tokenRes.status}).`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error('Resposta OAuth2 do Discord não contém access_token.');
  }

  const accessToken = tokenData.access_token;

  // 2. Obtém dados do utilizador (/users/@me)
  const userRes = await fetchImpl('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!userRes.ok) {
    throw new Error('Não foi possível obter o perfil do utilizador no Discord.');
  }

  const userData = (await userRes.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  const guildId = resolveEffectiveGuildId(config, botClient);

  // 3. Verifica pertença ao servidor Discord configurado e obtém cargos
  let roleIds: string[] = [];
  let isAdmin = false;
  let isMember = false;

  // Tenta primeiro via API OAuth2 de membro do servidor
  const memberRes = await fetchImpl(
    `https://discord.com/api/v10/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (memberRes.ok) {
    isMember = true;
    const memberData = (await memberRes.json()) as {
      roles?: string[];
      permissions?: string;
    };
    roleIds = Array.isArray(memberData.roles) ? memberData.roles : [];
    if (memberData.permissions) {
      try {
        const permBits = BigInt(memberData.permissions);
        if (
          (permBits & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
          (permBits & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild
        ) {
          isAdmin = true;
        }
      } catch {
        // Ignorado
      }
    }
  }

  // Complementa com a informação em tempo real da guild no cliente do Bot, se disponível
  const guild = botClient?.guilds?.cache?.get(guildId);
  if (guild) {
    if (guild.ownerId === userData.id) {
      isMember = true;
      isAdmin = true;
    }
    try {
      const guildMember =
        guild.members.cache.get(userData.id) ?? (await guild.members.fetch(userData.id));
      if (guildMember) {
        isMember = true;
        roleIds = Array.from(guildMember.roles.cache.keys());
        if (
          guildMember.permissions.has(PermissionFlagsBits.Administrator) ||
          guildMember.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
          isAdmin = true;
        }
      }
    } catch {
      // Se não estiver na cache/fetch do bot, confia no resultado da API OAuth2
    }
  }

  if (!isMember) {
    const err = new Error('Acesso negado: não pertences ao servidor Discord configurado na Sonora.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  const configuredDjRoles = new Set(database.getDjRoles(guildId).map((r) => r.roleId));
  const settings = database.getGuildSettings(guildId);
  const isDj =
    isAdmin ||
    (!settings.djOnlyMode && configuredDjRoles.size === 0) ||
    roleIds.some((rId) => configuredDjRoles.has(rId));

  const avatarUrl = userData.avatar
    ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=128`
    : null;

  return {
    userId: userData.id,
    username: userData.username,
    displayName: userData.global_name || userData.username,
    avatarUrl,
    guildId,
    isAdmin,
    isDj,
    roleIds
  };
}

export function mapSessionToAuthenticatedUser(
  session: WebSessionRecord,
  database: SonoraDatabase
): AuthenticatedUser {
  const guildSettings = database.getGuildSettings(session.guildId);
  const userLang = database.getUserLanguage(session.userId) ?? guildSettings.language;
  const djRoleIds = new Set(database.getDjRoles(session.guildId).map((r) => r.roleId));

  const isDj =
    session.isAdmin ||
    session.isDj ||
    (!guildSettings.djOnlyMode && djRoleIds.size === 0) ||
    session.roleIds.some((id) => djRoleIds.has(id));

  return {
    id: session.userId,
    username: session.username,
    displayName: session.displayName,
    avatarUrl: session.avatarUrl,
    guildId: session.guildId,
    isAdmin: session.isAdmin,
    isDj,
    roleIds: session.roleIds,
    preferredLanguage: userLang
  };
}
