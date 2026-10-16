import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandingDir = path.resolve(__dirname, '../apps/web/public/branding');

// Tabela CRC32 para chunks PNG
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function blendPixel(buf, width, x, y, r, g, b, alpha) {
  if (alpha <= 0) return;
  const idx = (y * width + x) * 4;
  const a = clamp(alpha, 0, 1);
  const dstA = buf[idx + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * a + buf[idx] * dstA * (1 - a)) / outA);
  buf[idx + 1] = Math.round((g * a + buf[idx + 1] * dstA * (1 - a)) / outA);
  buf[idx + 2] = Math.round((b * a + buf[idx + 2] * dstA * (1 - a)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distToArc(px, py, cx, cy, radius, minAngle, maxAngle) {
  const angle = Math.atan2(py - cy, px - cx);
  const clampedAngle = clamp(angle, minAngle, maxAngle);
  const ax = cx + radius * Math.cos(clampedAngle);
  const ay = cy + radius * Math.sin(clampedAngle);
  return Math.hypot(px - ax, py - ay);
}

function renderSonoraSymbol(size, isCover = false) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 64;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / scale;
      const gy = (y + 0.5) / scale;

      // Fundo arredondado (#090A0C) com borda subtil (#1E2430)
      const half = 30;
      const rad = isCover ? 5 : 14;
      const dx = Math.max(Math.abs(gx - 32) - (half - rad), 0);
      const dy = Math.max(Math.abs(gy - 32) - (half - rad), 0);
      const dRect = Math.hypot(dx, dy) - rad;
      const bgAlpha = clamp(0.5 - dRect * scale, 0, 1);
      if (bgAlpha > 0) {
        blendPixel(buf, size, x, y, 9, 10, 12, bgAlpha);
      }
      const dBorder = Math.abs(dRect + 0.6) - 0.6;
      if (dBorder < 1 / scale) {
        blendPixel(buf, size, x, y, 30, 36, 48, clamp(0.5 - dBorder * scale, 0, 1));
      }

      if (isCover) {
        // Anéis acústicos de fundo para capa alternativa
        const dCenter = Math.hypot(gx - 32, gy - 32);
        const ring1 = Math.abs(dCenter - 25) - 0.35;
        const ring2 = Math.abs(dCenter - 20) - 0.35;
        if (ring1 < 1 / scale) {
          blendPixel(buf, size, x, y, 30, 36, 48, clamp(0.5 - ring1 * scale, 0, 0.85));
        }
        if (ring2 < 1 / scale) {
          blendPixel(buf, size, x, y, 16, 185, 129, clamp(0.5 - ring2 * scale, 0, 0.25));
        }
      }

      // 1. Cabeça da nota musical (cx=23, cy=41, r=6.8) -> #F8FAFC
      const dNoteHead = Math.hypot(gx - 23, gy - 41) - 6.8;
      if (dNoteHead < 1 / scale) {
        blendPixel(buf, size, x, y, 248, 250, 252, clamp(0.5 - dNoteHead * scale, 0, 1));
      }

      // 2. Haste vertical e topo da nota -> #F8FAFC
      const dStem = Math.min(
        distToSegment(gx, gy, 27.5, 41, 27.5, 16),
        distToSegment(gx, gy, 27.5, 16, 31, 16)
      ) - 2.5;
      if (dStem < 1 / scale) {
        blendPixel(buf, size, x, y, 248, 250, 252, clamp(0.5 - dStem * scale, 0, 1));
      }

      // 3. Pulso acústico interior (x=13, y=28..36) -> #94A3B8
      const dPulse = distToSegment(gx, gy, 13, 28, 13, 36) - 2.0;
      if (dPulse < 1 / scale) {
        blendPixel(buf, size, x, y, 148, 163, 184, clamp(0.5 - dPulse * scale, 0, 1));
      }

      // 4. Ondas sonoras concêntricas com pontas arredondadas (Verde Musical Sonora #10B981)
      const dWave1 = distToArc(gx, gy, 30, 33.5, 13.5, -0.92, 0.92) - 2.25;
      if (dWave1 < 1 / scale) {
        blendPixel(buf, size, x, y, 16, 185, 129, clamp(0.5 - dWave1 * scale, 0, 1));
      }
      const dWave2 = distToArc(gx, gy, 30, 33.5, 22.5, -0.82, 0.82) - 2.25;
      if (dWave2 < 1 / scale) {
        blendPixel(buf, size, x, y, 16, 185, 129, clamp(0.5 - dWave2 * scale, 0, 0.8));
      }
    }
  }

  return encodePng(size, size, buf);
}

fs.mkdirSync(brandingDir, { recursive: true });

const favicon32 = renderSonoraSymbol(32, false);
fs.writeFileSync(path.join(brandingDir, 'favicon-32.png'), favicon32);

const avatar512 = renderSonoraSymbol(512, false);
fs.writeFileSync(path.join(brandingDir, 'discord-avatar-512.png'), avatar512);

const coverFallback512 = renderSonoraSymbol(512, true);
fs.writeFileSync(path.join(brandingDir, 'cover-fallback-512.png'), coverFallback512);

console.log('Recursos PNG Sonora gerados com sucesso em:', brandingDir);
