import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs are required for Tauri production builds (absolute /assets/* fails in the webview).
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
  define: {
    'process.env.LINGUA_VENDOR_MODE': JSON.stringify(
      process.env.LINGUA_VENDOR_MODE ?? 'mock',
    ),
    'process.env.DEEPSEEK_API_KEY': JSON.stringify(process.env.DEEPSEEK_API_KEY ?? ''),
  },
});
