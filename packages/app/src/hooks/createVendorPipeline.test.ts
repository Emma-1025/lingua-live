import { DEFAULT_VENDOR_CONFIG } from '@lingua-live/core';
import { describe, expect, it } from 'vitest';
import { createVendorPipelineParts } from './createVendorPipeline.js';

describe('createVendorPipelineParts', () => {
  it('surfaces real ASR setup errors instead of silently falling back', () => {
    const parts = createVendorPipelineParts({
      config: {
        ...DEFAULT_VENDOR_CONFIG,
        mode: 'real',
        deepgramApiKey: '',
      },
    });

    expect(parts.config.mode).toBe('mock');
    expect(parts.setupError).toMatch(/Real ASR requires/);
  });
});
