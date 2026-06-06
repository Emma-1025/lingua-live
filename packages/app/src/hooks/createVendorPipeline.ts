import {
  createVendorServices,
  createWebAudioSourceMonitor,
  loadVendorConfig,
  type MockSpeechRecognizerDeps,
  type VendorConfig,
} from '@lingua-live/core';

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
  try {
    const services = createVendorServices({ mockRecognizerDeps });
    return {
      config: services.config,
      recognizer: services.recognizer,
      synthesizer: services.synthesizer,
      sourceMonitor: createWebAudioSourceMonitor(),
    };
  } catch {
    const services = createVendorServices({
      config: { ...loadVendorConfig({ LINGUA_VENDOR_MODE: 'mock' }), mode: 'mock' },
      mockRecognizerDeps,
    });

    return {
      config: services.config,
      recognizer: services.recognizer,
      synthesizer: services.synthesizer,
      sourceMonitor: createWebAudioSourceMonitor(),
    };
  }
}
