import { describe, it, expect } from 'vitest';
import { parseAppConfig } from '../src/index.js';

describe('AppConfig Startup Validation', () => {
  const validEnv = {
    NODE_ENV: 'development',
    DISCORD_TOKEN: 'test-token-123456',
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_GUILD_ID: '987654321098765432',
    SESSION_SECRET: 'super_secret_random_session_key_with_32_plus_chars'
  };

  it('parses valid environment configuration with safe defaults', () => {
    const cfg = parseAppConfig(validEnv);
    expect(cfg.DEFAULT_LANGUAGE).toBe('pt-PT');
    expect(cfg.PORT).toBe(3001);
    expect(cfg.HOST).toBe('127.0.0.1');
    expect(cfg.TRUST_PROXY).toBe(false);
    expect(cfg.ALLOW_INSECURE_DIRECT_AUDIO_HTTP).toBe(false);
  });

  it('rejects short SESSION_SECRET or invalid Discord Snowflake IDs', () => {
    expect(() =>
      parseAppConfig({
        ...validEnv,
        SESSION_SECRET: 'curto'
      })
    ).toThrow(/SESSION_SECRET/);

    expect(() =>
      parseAppConfig({
        ...validEnv,
        DISCORD_GUILD_ID: 'invalid-snowflake'
      })
    ).toThrow(/DISCORD_GUILD_ID/);
  });

  it('enforces strict secret checks in production mode', () => {
    expect(() =>
      parseAppConfig({
        ...validEnv,
        NODE_ENV: 'production',
        SESSION_SECRET: 'altera_este_segredo_para_uma_string_aleatoria_com_pelo_menos_32_caracteres'
      })
    ).toThrow(/produção/);

    expect(() =>
      parseAppConfig({
        ...validEnv,
        NODE_ENV: 'production',
        DISCORD_CLIENT_SECRET: ''
      })
    ).toThrow(/DISCORD_CLIENT_SECRET/);
  });
});
