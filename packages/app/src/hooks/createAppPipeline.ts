import {
  createCorrectionEngine,
  createLlmClientWithEnvFallback,
  createPipeline,
  createSessionIngestor,
  createTranslator,
  type LlmSettings,
  type NativeAudioCaptureBridge,
} from '@lingua-live/core';
import { getAppFetch } from '../desktop/tauriHttpFetch.js';
import { decodeAudioFileToMono16k } from '../lib/decodeAudioFile.js';
import type { VendorPipelineParts } from './createVendorPipeline.js';

export interface CreateAppPipelineOptions {
  llmSettings: LlmSettings;
  vendorParts: VendorPipelineParts;
  captureBridge?: NativeAudioCaptureBridge | null;
  readFile?: (filePath: string) => Promise<ArrayBuffer>;
  isFileAccessible?: (filePath: string) => Promise<boolean>;
}

export function createAppPipeline(options: CreateAppPipelineOptions) {
  const llmClientOptions = { fetchFn: getAppFetch() };
  const translationClient = createLlmClientWithEnvFallback(
    options.llmSettings,
    'translation',
    llmClientOptions,
  );
  const correctionClient = createLlmClientWithEnvFallback(
    options.llmSettings,
    'correction',
    llmClientOptions,
  );
  const translator = createTranslator({ client: translationClient });

  return createPipeline({
    ingestor: createSessionIngestor({
      captureBridge: options.captureBridge ?? undefined,
      readFile: options.readFile,
      isFileAccessible: options.isFileAccessible,
      decodeFile: decodeAudioFileToMono16k,
    }),
    translator,
    correctionEngine: createCorrectionEngine({
      translator,
      client: correctionClient,
    }),
    recognizer: options.vendorParts.recognizer,
    synthesizer: options.vendorParts.synthesizer,
    sourceMonitor: options.vendorParts.sourceMonitor,
  });
}
