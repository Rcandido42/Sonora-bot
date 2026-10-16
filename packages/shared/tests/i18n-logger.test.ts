import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { TRANSLATIONS, t, formatDuration, createLogger } from '../src/index.js';

describe('Internationalization (pt-PT & en) and Secret-Free Logging', () => {
  it('maintains 100% key parity between pt-PT and en dictionaries', () => {
    const ptKeys = Object.keys(TRANSLATIONS['pt-PT']).sort();
    const enKeys = Object.keys(TRANSLATIONS.en).sort();
    expect(ptKeys).toEqual(enKeys);
  });

  it('interpolates parameters accurately in both languages', () => {
    expect(t('pt-PT', 'player.trackAdded', { title: 'Starlight', artist: 'Muse' })).toBe(
      'Adicionada à fila: **Starlight** — Muse'
    );
    expect(t('en', 'player.trackAdded', { title: 'Starlight', artist: 'Muse' })).toBe(
      'Added to queue: **Starlight** — Muse'
    );
  });

  it('formats track durations cleanly', () => {
    expect(formatDuration(null)).toBe('--:--');
    expect(formatDuration(0)).toBe('--:--');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_665_000)).toBe('1:01:05');
  });

  it('redacts sensitive secrets and tokens from structured logs', () => {
    const lines: string[] = [];
    const dest = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      }
    });

    const testLogger = createLogger('sonora-test', 'info', dest);
    testLogger.info(
      {
        DISCORD_TOKEN: 'secret-discord-bot-token-value',
        SESSION_SECRET: 'secret-session-cookie-signing-key',
        nested: {
          accessToken: 'oauth2-bearer-secret-token'
        },
        safeField: 'sonora-public-info'
      },
      'Booting Sonora'
    );

    expect(lines.length).toBe(1);
    const output = lines[0];
    expect(output).toContain('sonora-public-info');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('secret-discord-bot-token-value');
    expect(output).not.toContain('secret-session-cookie-signing-key');
    expect(output).not.toContain('oauth2-bearer-secret-token');
  });
});
