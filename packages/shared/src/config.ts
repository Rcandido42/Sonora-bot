import { z } from 'zod';

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((val) => {
    if (typeof val === 'boolean') return val;
    if (!val) return false;
    return ['true', '1', 'yes', 'on'].includes(val.trim().toLowerCase());
  });

export const AppConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DEFAULT_LANGUAGE: z.enum(['pt-PT', 'en']).default('pt-PT'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN é obrigatório'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{15,22}$/, 'DISCORD_CLIENT_ID deve ser um ID numérico válido do Discord (Snowflake)'),
  DISCORD_GUILD_ID: z.string().regex(/^\d{15,22}$/, 'DISCORD_GUILD_ID deve ser um ID numérico válido do servidor Discord (Snowflake)'),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  OAUTH_REDIRECT_URI: z.string().url('OAUTH_REDIRECT_URI deve ser um URL válido').default('http://localhost:3001/api/auth/callback'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET deve ter pelo menos 32 caracteres para segurança criptográfica'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(604800),

  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_WEB_URL: z.string().url('PUBLIC_WEB_URL deve ser um URL válido').default('http://localhost:5173'),
  TRUST_PROXY: booleanFromEnv.default(false),

  DATABASE_PATH: z.string().min(1).default('./data/sonora.db'),
  BACKUP_DIR: z.string().min(1).default('./backups'),

  SPOTIFY_CLIENT_ID: z.string().optional().default(''),
  SPOTIFY_CLIENT_SECRET: z.string().optional().default(''),
  GENIUS_ACCESS_TOKEN: z.string().optional().default(''),
  LRCLIB_API_URL: z.string().url().default('https://lrclib.net/api'),

  FFMPEG_PATH: z.string().optional().default(''),
  YTDLP_PATH: z.string().optional().default(''),
  ALLOW_INSECURE_DIRECT_AUDIO_HTTP: booleanFromEnv.default(false)
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function parseAppConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = AppConfigSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`[Sonora Config] Falha na validação das variáveis de ambiente:\n${details}`);
  }

  const config = result.data;
  if (config.NODE_ENV === 'production') {
    if (config.SESSION_SECRET.includes('altera_este_segredo')) {
      throw new Error('[Sonora Config] Em produção, SESSION_SECRET não pode utilizar o valor de exemplo.');
    }
    if (!config.DISCORD_CLIENT_SECRET) {
      throw new Error('[Sonora Config] Em produção, DISCORD_CLIENT_SECRET é obrigatório para OAuth2.');
    }
  }

  return config;
}
