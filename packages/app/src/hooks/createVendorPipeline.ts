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
}

/** Builds vendor-backed recognizer/synthesizer; falls back to mocks when real keys are unavailable. */
export function createVendorPipelineParts(
  mockRecognizerDeps?: MockSpeechRecognizerDeps,
): VendorPipelineParts {
  const recognizerDeps = resolveMockRecognizerDeps(mockRecognizerDeps);

  try {
    const services = createVendorServices({ mockRecognizerDeps: recognizerDeps });
    return {
      config: services.config,
      recognizer: services.recognizer,
      synthesizer: services.synthesizer,
      sourceMonitor: createWebAudioSourceMonitor(),
    };
  } catch {
    const services = createVendorServices({
      config: { ...loadVendorConfig({ LINGUA_VENDOR_MODE: 'mock' }), mode: 'mock' },
      mockRecognizerDeps: recognizerDeps,
    });

    return {
      config: services.config,
      recognizer: services.recognizer,
      synthesizer: services.synthesizer,
      sourceMonitor: createWebAudioSourceMonitor(),
    };
  }
}
