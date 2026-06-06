import type {
  AudioDeviceInfo,
  AudioFrame,
  AudioSourceSelection,
  NativeAudioCaptureBridge,
  SourceLostReason,
} from '@lingua-live/core';

interface AudioSourceDto {
  id: string;
  label: string;
  kind: 'system' | 'microphone';
}

interface AudioFrameDto {
  sessionId: string;
  seq: number;
  capturedAt: number;
  pcm: number[];
  durationMs: number;
}

export async function createTauriCaptureBridge(): Promise<NativeAudioCaptureBridge | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  const frameHandlers = new Set<(frame: AudioFrame) => void>();
  const lostHandlers = new Set<(reason: SourceLostReason) => void>();
  let frameUnlisten: (() => void) | undefined;
  let lostUnlisten: (() => void) | undefined;

  return {
    async listSources(): Promise<AudioDeviceInfo[]> {
      const sources = await invoke<AudioSourceDto[]>('list_audio_sources');
      return sources.map((source) => ({
        id: source.id,
        label: source.label,
        kind: source.kind,
      }));
    },

    async startCapture(options: {
      sessionId: string;
      selection: AudioSourceSelection;
    }): Promise<void> {
      await frameUnlisten?.();
      await lostUnlisten?.();

      frameUnlisten = await listen<AudioFrameDto>('audio-frame', (event) => {
        const payload = event.payload;
        const frame: AudioFrame = {
          sessionId: payload.sessionId,
          seq: payload.seq,
          capturedAt: payload.capturedAt,
          pcm: Float32Array.from(payload.pcm),
          durationMs: payload.durationMs,
        };
        for (const handler of frameHandlers) {
          handler(frame);
        }
      });

      lostUnlisten = await listen<string>('audio-source-lost', (event) => {
        const reason = mapSourceLostReason(event.payload);
        for (const handler of lostHandlers) {
          handler(reason);
        }
      });

      await invoke('start_audio_capture', {
        sessionId: options.sessionId,
        sourceKind: options.selection.kind,
        deviceId: options.selection.deviceId ?? null,
      });
    },

    async stopCapture(): Promise<void> {
      await invoke('stop_audio_capture');
      await frameUnlisten?.();
      await lostUnlisten?.();
      frameUnlisten = undefined;
      lostUnlisten = undefined;
    },

    onFrame(handler: (frame: AudioFrame) => void): () => void {
      frameHandlers.add(handler);
      return () => frameHandlers.delete(handler);
    },

    onSourceLost(handler: (reason: SourceLostReason) => void): () => void {
      lostHandlers.add(handler);
      return () => lostHandlers.delete(handler);
    },
  };
}

function mapSourceLostReason(payload: string): SourceLostReason {
  if (payload === 'permission_revoked') {
    return 'permission_revoked';
  }
  if (payload === 'file_unreadable') {
    return 'file_unreadable';
  }
  return 'device_disconnect';
}

export async function createTauriFileAccess() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return {
    readFile: async (filePath: string) => {
      const bytes = await invoke<number[]>('read_audio_file', { path: filePath });
      return Uint8Array.from(bytes).buffer;
    },
    isFileAccessible: async (filePath: string) =>
      invoke<boolean>('is_file_accessible', { path: filePath }),
  };
}
