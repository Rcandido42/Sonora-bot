import { describe, it, expect } from 'vitest';
import {
  isPrivateOrReservedIp,
  validateSafeExternalUrl,
  resolveSafeUrlWithRedirects,
  SsrfValidationError
} from '../src/index.js';

describe('Anti-SSRF URL & Redirect Protection', () => {
  it('accurately detects private, loopback, link-local and reserved IPv4/IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.100')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:7f00:0001')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);

    // Endereços públicos válidos
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks non-HTTPS protocols, localhost, internal suffixes and DNS rebinding to private IPs', async () => {
    await expect(validateSafeExternalUrl('file:///etc/passwd')).rejects.toThrow(SsrfValidationError);
    await expect(validateSafeExternalUrl('http://example.com/audio.mp3')).rejects.toThrow(/HTTPS/);
    await expect(validateSafeExternalUrl('https://localhost:3001/api')).rejects.toThrow(/bloqueado/);
    await expect(validateSafeExternalUrl('https://router.local/stream.mp3')).rejects.toThrow(/bloqueado/);
    await expect(validateSafeExternalUrl('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(/bloqueado/);

    // Simula DNS rebinding (domínio externo que resolve para 127.0.0.1)
    await expect(
      validateSafeExternalUrl('https://evil.example.com/track.mp3', {
        lookupFn: async () => [{ address: '127.0.0.1', family: 4 }]
      })
    ).rejects.toThrow(/IP interno ou reservado/);

    // Domínio externo público válido (simulado via lookupFn para teste determinístico)
    const valid = await validateSafeExternalUrl('https://cdn.example.com/audio/song.mp3', {
      lookupFn: async () => [{ address: '93.184.216.34', family: 4 }]
    });
    expect(valid.hostname).toBe('cdn.example.com');
  });

  it('blocks malicious HTTP redirects pointing to internal addresses', async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('cdn.example.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1:3001/internal-secret' }
        });
      }
      return new Response(null, { status: 200 });
    };

    await expect(
      resolveSafeUrlWithRedirects('https://cdn.example.com/redirect.mp3', {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchFn: mockFetch as typeof fetch
      })
    ).rejects.toThrow(SsrfValidationError);
  });
});
