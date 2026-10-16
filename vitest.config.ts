import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@sonora/shared': path.resolve(rootDir, 'packages/shared/src/index.ts'),
      '@sonora/database': path.resolve(rootDir, 'packages/database/src/index.ts'),
      '@sonora/audio-engine': path.resolve(rootDir, 'packages/audio-engine/src/index.ts')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/tests/**/*.test.ts',
      'apps/server/tests/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}'
    ],
    testTimeout: 15000
  }
});
