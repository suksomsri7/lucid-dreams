import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    /**
     * 60 s, not the default 5 s — forced by oracle L1.6 G5 (v2-C, 24 ก.ย.).
     *
     * G5 walks the rendered PCM sample by sample inside `expect()`. The v2-C signature is
     * 9.8 s long, i.e. 470,400 samples at 48 kHz, and vitest spends ~34 µs per assertion:
     * measured **16 s in the assertion loop alone**, with the synthesis itself at ~1.9 s. No
     * implementation can make that fit in 5 s, so the limit had to move rather than the test.
     */
    testTimeout: 60_000,
  },
});
