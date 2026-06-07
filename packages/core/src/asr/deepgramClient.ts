import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import type { SupportedSourceLanguage } from '../models.js';
import { DEFAULT_DEEPGRAM_BASE_URL } from '../vendors/constants.js';
import { float32ToLinear16 } from './pcmEncoding.js';

export interface DeepgramSocket {
  readonly readyState: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: unknown) => void): void;
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: unknown) => void): void;
}

export interface DeepgramSocketConnectOptions {
  apiKey: string;
}

export interface DeepgramSocketFactory {
  connect(url: string, options: DeepgramSocketConnectOptions): DeepgramSocket;
}

export interface DeepgramListenParams {
  apiKey: string;
  language: SupportedSourceLanguage;
  sampleRate?: number;
  baseUrl?: string;
  socketFactory?: DeepgramSocketFactory;
}

export interface DeepgramTranscriptEvent {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
  startedAt: number;
}

export type DeepgramTranscriptHandler = (event: DeepgramTranscriptEvent) => void;

const LANGUAGE_CODES: Record<SupportedSourceLanguage, string> = {
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  zh: 'zh',
};

export class DeepgramStreamingClient {
  private socket: DeepgramSocket | null = null;
  private openPromise: Promise<void> | null = null;
  private transcriptHandler: DeepgramTranscriptHandler | null = null;
  private readonly apiKey: string;
  private readonly sampleRate: number;
  private readonly baseUrl: string;
  private readonly socketFactory: DeepgramSocketFactory;
  private language: SupportedSourceLanguage = 'en';

  constructor(params: DeepgramListenParams) {
    this.apiKey = params.apiKey;
    this.sampleRate = params.sampleRate ?? TARGET_SAMPLE_RATE;
    this.baseUrl = params.baseUrl ?? DEFAULT_DEEPGRAM_BASE_URL;
    this.socketFactory = params.socketFactory ?? defaultSocketFactory;
  }

  setLanguage(language: SupportedSourceLanguage): void {
    this.language = language;
    if (this.socket) {
      this.reconnect();
    }
  }

  onTranscript(handler: DeepgramTranscriptHandler): void {
    this.transcriptHandler = handler;
  }

  async sendPcm(pcm: Float32Array): Promise<void> {
    await this.ensureOpen();
    this.socket?.send(float32ToLinear16(pcm));
  }

  async finalize(): Promise<void> {
    if (!this.socket) {
      return;
    }

    this.socket.send(JSON.stringify({ type: 'CloseStream' }));
  }

  reset(): void {
    this.closeSocket();
    this.openPromise = null;
  }

  private reconnect(): void {
    this.closeSocket();
    this.openPromise = null;
  }

  private async ensureOpen(): Promise<void> {
    if (this.socket && this.socket.readyState === 1) {
      return;
    }

    if (!this.openPromise) {
      this.openPromise = this.openSocket();
    }

    await this.openPromise;
  }

  private async openSocket(): Promise<void> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(this.sampleRate));
    url.searchParams.set('channels', '1');
    url.searchParams.set('language', LANGUAGE_CODES[this.language]);
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('vad_events', 'true');

    const socket = this.socketFactory.connect(url.toString(), {
      apiKey: this.apiKey,
    });
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      this.handleMessage(event);
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Deepgram WebSocket connection failed'));
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Deepgram WebSocket closed before opening'));
      };

      const cleanup = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }

  private handleMessage(event: unknown): void {
    const data = extractMessageData(event);
    if (!data) {
      return;
    }

    let payload: DeepgramResultsMessage;
    try {
      payload = JSON.parse(data) as DeepgramResultsMessage;
    } catch {
      return;
    }

    if (payload.type !== 'Results') {
      return;
    }

    const transcript = payload.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
    if (!transcript) {
      return;
    }

    this.transcriptHandler?.({
      transcript,
      isFinal: Boolean(payload.is_final),
      speechFinal: Boolean(payload.speech_final),
      startedAt: payload.start ?? 0,
    });
  }

  private closeSocket(): void {
    if (!this.socket) {
      return;
    }

    try {
      this.socket.close();
    } catch {
      // Ignore close errors during reset.
    }

    this.socket = null;
  }
}

interface DeepgramResultsMessage {
  type?: string;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
}

function extractMessageData(event: unknown): string | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const data = (event as { data?: unknown }).data;
  if (typeof data === 'string') {
    return data;
  }

  return null;
}

const defaultSocketFactory: DeepgramSocketFactory = {
  connect(url, { apiKey }) {
    if (typeof WebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this environment');
    }

    // Browser/Tauri WebViews cannot set Authorization headers; Deepgram expects
    // Sec-WebSocket-Protocol: token, <api_key> during the handshake.
    return new WebSocket(url, ['token', apiKey]) as unknown as DeepgramSocket;
  },
};
