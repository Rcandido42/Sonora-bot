import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SONORA_BRAND } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webPublicDir = path.resolve(__dirname, '../../../apps/web/public');

describe('Sonora Branding & Visual Identity', () => {
  it('defines Sonora as the official brand name and excludes legacy names', () => {
    expect(SONORA_BRAND.name).toBe('Sonora');
    expect(SONORA_BRAND.upperName).toBe('SONORA');
    const serialized = JSON.stringify(SONORA_BRAND).toLowerCase();
    expect(serialized).not.toContain('noxify');
    expect(serialized).not.toContain('vynox');
    expect(serialized).not.toContain('auralis');
  });

  it('defines dark-first color palette and musical green accent', () => {
    expect(SONORA_BRAND.colors.bgPrimary).toBe('#090A0C');
    expect(SONORA_BRAND.colors.textPrimary).toBe('#F8FAFC');
    expect(SONORA_BRAND.colors.accent).toBe('#10B981');
    expect(SONORA_BRAND.colors.discordEmbedAccent).toBe(0x10b981);
  });

  it('verifies all SVG and raster PNG branding assets physically exist on disk', () => {
    const assetPaths = [
      SONORA_BRAND.assets.symbolDark,
      SONORA_BRAND.assets.symbolLight,
      SONORA_BRAND.assets.horizontalDark,
      SONORA_BRAND.assets.horizontalLight,
      SONORA_BRAND.assets.faviconSvg,
      SONORA_BRAND.assets.faviconPng32,
      SONORA_BRAND.assets.discordAvatarPng512,
      SONORA_BRAND.assets.coverFallbackSvg,
      SONORA_BRAND.assets.coverFallbackPng512
    ];

    for (const relPath of assetPaths) {
      const fullPath = path.join(webPublicDir, relPath.replace(/^\//, ''));
      expect(fs.existsSync(fullPath), `Missing branding asset: ${fullPath}`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(200);

      if (fullPath.endsWith('.svg')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        expect(content).toContain('<svg');
        expect(content).toContain('</svg>');
      } else if (fullPath.endsWith('.png')) {
        const buf = fs.readFileSync(fullPath);
        // Assinatura PNG: 89 50 4E 47 0D 0A 1A 0A
        expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      }
    }
  });
});
