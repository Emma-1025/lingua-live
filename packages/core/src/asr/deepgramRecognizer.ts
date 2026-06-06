import {
  DEFAULT_SOURCE_LANGUAGE,
  type AudioFrame,
  type SegmentStatus,
  type SourceSegment,
  type SupportedSourceLanguage,
} from '../models.js';
import { SpokenIndexAllocator } from '../utils/ids.js';
import {
  DeepgramStreamingClient,
  type DeepgramSocketFactory,
  type DeepgramTranscriptEvent,
} from './deepgramClient.js';
import type { SpeechRecognizer, UnrecognizedEvent } from './recognizer.js';

type SegmentHandler = (segment: SourceSegment) => void;
type UnrecognizedHandler = (event: UnrecognizedEvent) => void;

export interface DeepgramSpeechRecognizerConfig {
  apiKey: string;
  socketFactory?: DeepgramSocketFactory;
  spokenIndexAllocator?: SpokenIndexAllocator;
  now?: () => number;
}

interface ActiveUtterance {
  segmentId: string;
  sessionId: string;
  spokenIndex: number;
  startedAt: number;
}

/**
 * Streaming ASR backed by Deepgram's listen WebSocket API.
 * Maps interim/final transcripts onto the shared SourceSegment model.
 */
export class DeepgramSpeechRecognizer implements SpeechRecognizer {
  private readonly client: DeepgramStreamingClient;
  private readonly spokenIndexAllocator: SpokenIndexAllocator;
  private readonly now: () => number;

  private language: SupportedSourceLanguage = DEFAULT_SOURCE_LANGUAGE;
  private sessionId = '';
  private utteranceCounter = 0;
  private activeUtterance: ActiveUtterance | null = null;

  private readonly segmentHandlers = new Set<SegmentHandler>();
  private readonly unrecognizedHandlers = new Set<UnrecognizedHandler>();

  constructor(config: DeepgramSpeechRecognizerConfig) {
    this.client = new DeepgramStreamingClient({
      apiKey: config.apiKey,
      language: this.language,
      socketFactory: config.socketFactory,
    });
    this.spokenIndexAllocator = config.spokenIndexAllocator ?? new SpokenIndexAllocator();
    this.now = config.now ?? (() => Date.now());

    this.client.onTranscript((event) => {
      this.handleTranscript(event);
    });
  }

  setLanguage(lang: SupportedSourceLanguage): void {
    this.language = lang;
    this.client.setLanguage(lang);
  }

  getLanguage(): SupportedSourceLanguage {
    return this.language;
  }

  pushAudio(frame: AudioFrame): void {
    this.sessionId = frame.sessionId;
    void this.client.sendPcm(frame.pcm);
  }

  flush(): void {
    void this.client.finalize();
  }

  reset(): void {
    this.client.reset();
    this.spokenIndexAllocator.reset();
    this.sessionId = '';
    this.utteranceCounter = 0;
    this.activeUtterance = null;
  }

  onSegment(handler: SegmentHandler): () => void {
    this.segmentHandlers.add(handler);
    return () => this.segmentHandlers.delete(handler);
  }

  onUnrecognized(handler: UnrecognizedHandler): () => void {
    this.unrecognizedHandlers.add(handler);
    return () => this.unrecognizedHandlers.delete(handler);
  }

  private handleTranscript(event: DeepgramTranscriptEvent): void {
    if (!this.sessionId) {
      return;
    }

    if (!this.activeUtterance) {
      this.activeUtterance = this.openUtterance(event.startedAt);
    }

    const status: SegmentStatus = event.isFinal ? 'final' : 'partial';
    const segment: SourceSegment = {
      id: this.activeUtterance.segmentId,
      sessionId: this.activeUtterance.sessionId,
      text: event.transcript,
      status,
      startedAt: this.activeUtterance.startedAt,
      spokenIndex: this.activeUtterance.spokenIndex,
      recognizable: true,
    };

    for (const handler of this.segmentHandlers) {
      handler(segment);
    }

    if (event.speechFinal || (event.isFinal && status === 'final')) {
      this.activeUtterance = null;
    }
  }

  private openUtterance(startedAt: number): ActiveUtterance {
    const utteranceIndex = this.utteranceCounter;
    this.utteranceCounter += 1;

    return {
      segmentId: `${this.sessionId}-utt-${utteranceIndex}`,
      sessionId: this.sessionId,
      spokenIndex: this.spokenIndexAllocator.allocate(),
      startedAt: Math.round(startedAt * 1_000) || this.now(),
    };
  }
}

export function createDeepgramSpeechRecognizer(
  config: DeepgramSpeechRecognizerConfig,
): SpeechRecognizer {
  return new DeepgramSpeechRecognizer(config);
}
