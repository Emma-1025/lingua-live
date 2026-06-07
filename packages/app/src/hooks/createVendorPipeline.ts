import {
  createGoldenClipDriver,
  createVendorServices,
  createWebAudioSourceMonitor,
  loadVendorConfig,
  type MockSpeechRecognizerDeps,
  type VendorConfig,
} from '@lingua-live/core';

function resolveMockRecognizerDeps(
  mockRecognizerDeps?: MockSpeechRecognizerDeps,
): MockSpeechRecognizerDeps | undefined {
  // Must reference process.env.LINGUA_MOCK_ASR_SCENARIO directly so Vite define can inline it.
  const scenario = process.env.LINGUA_MOCK_ASR_SCENARIO;

  if (scenario === 'golden') {
    return { driver: createGoldenClipDriver(), ...mockRecognizerDeps };
  }

  return mockRecognizerDeps;
}

export interface VendorPipelineParts {
  config: VendorConfig;
  recognizer: ReturnType<typeof createVendorServices>['recognizer'];
  synthesizer: ReturnType<typeof createVendorServices>['synthesizer'];
  sourceMonitor: ReturnType<typeof createWebAudioSourceMonitor>;
  setupError?: string;
}

/** Builds vendor-backed recognizer/synthesizer; falls back to mocks when real keys are unavailable. */
export interface CreateVendorPipelinePartsOptions {
  config?: VendorConfig;
  mockRecognizerDeps?: MockSpeechRecognizerDeps;
}

export function createVendorPipelineParts(
  options: CreateVendorPipelinePartsOptions = {},
): VendorPipelineParts {
  const recognizerDeps = resolveMockRecognizerDeps(options.mockRecognizerDeps);

  try {
    const services = createVendorServices({
      config: options.config,
      mockRecognizerDeps: recognizerDeps,
    });
    return {
      config: services.config,
      recognizer: services.recognizer,
      synthesizer: services.synthesizer,
      sourceMonitor: createWebAudioSourceMonitor(),
    };
  } catch (error) {
    const services = createVendorServices({
      config: { ...loadVendorConfig({ LINGUA_VENDOR_MODE: 'mock' }), mode: 'mock' },
      mockRecognizerDeps: recognizerDeps,
    });

    return {
      config: services.config,
      recognizer: services.recognizer,
      synthesizer: services.synthesizer,
      sourceMonitor: createWebAudioSourceMonitor(),
      setupError:
        error instanceof Error
          ? error.message
          : '无法初始化语音服务，请检查 Deepgram / TTS 设置。',
    };
  }
}
