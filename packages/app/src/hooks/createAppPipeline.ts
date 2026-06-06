import {
  createCorrectionEngine,
  createLlmClientWithEnvFallback,
  createPipeline,
  createSessionIngestor,
  createTranslator,
  type LlmSettings,
  type NativeAudioCaptureBridge,
} from '@lingua-live/core';
import type { VendorPipelineParts } from './createVendorPipeline.js';

export interface CreateAppPipelineOptions {
  llmSettings: LlmSettings;
  vendorParts: VendorPipelineParts;
  captureBridge?: NativeAudioCaptureBridge | null;
  readFile?: (filePath: string) => Promise<ArrayBuffer>;
  isFileAccessible?: (filePath: string) => Promise<boolean>;
}

export function createAppPipeline(options: CreateAppPipelineOptions) {
  const translationClient = createLlmClientWithEnvFallback(options.llmSettings, 'translation');
  const correctionClient = createLlmClientWithEnvFallback(options.llmSettings, 'correction');
  const translator = createTranslator({ client: translationClient });

  return createPipeline({
    ingestor: createSessionIngestor({
      captureBridge: options.captureBridge ?? undefined,
      readFile: options.readFile,
      isFileAccessible: options.isFileAccessible,
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
