import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;
const platform = process.env.TAURI_ENV_PLATFORM;

/** Strip crossorigin — breaks ES module loading in Tauri's asset/custom protocol webview. */
function tauriStripCrossorigin() {
  return {
    name: 'tauri-strip-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  // Relative asset URLs are required for Tauri production builds.
  base: './',
  clearScreen: false,
  plugins: [react(), tauriStripCrossorigin()],
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ['**/packages/desktop/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  define: {
    'process.env.LINGUA_VENDOR_MODE': JSON.stringify(process.env.LINGUA_VENDOR_MODE ?? 'mock'),
    'process.env.DEEPGRAM_API_KEY': JSON.stringify(process.env.DEEPGRAM_API_KEY ?? ''),
    'process.env.TTS_API_KEY': JSON.stringify(process.env.TTS_API_KEY ?? ''),
    'process.env.OPENAI_API_KEY': JSON.stringify(process.env.OPENAI_API_KEY ?? ''),
    'process.env.TTS_BASE_URL': JSON.stringify(process.env.TTS_BASE_URL ?? ''),
    'process.env.TTS_MODEL': JSON.stringify(process.env.TTS_MODEL ?? ''),
    'process.env.TTS_VOICE': JSON.stringify(process.env.TTS_VOICE ?? ''),
    'process.env.DEEPSEEK_API_KEY': JSON.stringify(process.env.DEEPSEEK_API_KEY ?? ''),
    'process.env.LINGUA_MOCK_ASR_SCENARIO': JSON.stringify(
      process.env.LINGUA_MOCK_ASR_SCENARIO ?? '',
    ),
  },
  build: {
    // Tauri Linux/macOS use WebKit — target must match (see tauri.app/start/frontend/vite).
    target: platform === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    modulePreload: false,
  },
});
