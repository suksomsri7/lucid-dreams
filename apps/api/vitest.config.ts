import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // `@lucid/engine` ships TypeScript source (no build step in this monorepo), so point
      // vitest straight at it instead of letting it externalise a node_modules symlink.
      '@lucid/engine': path.resolve(here, '../../packages/engine/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The oracle starts a real HTTP server per file; forks keep ports and sqlite handles
    // from leaking between files.
    pool: 'forks',
    testTimeout: 20_000,
  },
});
