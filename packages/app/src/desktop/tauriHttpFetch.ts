import { isTauriRuntime } from './isTauri.js';

let tauriFetch: typeof fetch | undefined;

export async function initTauriHttpFetch(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const { fetch } = await import('@tauri-apps/plugin-http');
  tauriFetch = fetch;
}

export function getAppFetch(): typeof fetch | undefined {
  return isTauriRuntime() ? tauriFetch : undefined;
}
