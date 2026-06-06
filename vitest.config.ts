import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['packages/**/src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['packages/app/src/test/setup.ts'],
  },
});
