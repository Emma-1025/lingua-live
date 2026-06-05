import { describe, expect, it } from 'vitest';
import { createSegmentId, createSessionId, SpokenIndexAllocator } from './ids.js';

describe('createSegmentId', () => {
  it('returns unique non-empty ids', () => {
    const a = createSegmentId();
    const b = createSegmentId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('createSessionId', () => {
  it('returns unique non-empty ids', () => {
    const a = createSessionId();
    const b = createSessionId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('SpokenIndexAllocator', () => {
  it('allocates monotonically increasing indices starting at 0', () => {
    const allocator = new SpokenIndexAllocator();
    expect(allocator.allocate()).toBe(0);
    expect(allocator.allocate()).toBe(1);
    expect(allocator.allocate()).toBe(2);
    expect(allocator.peek()).toBe(3);
  });

  it('resets to 0 after reset()', () => {
    const allocator = new SpokenIndexAllocator();
    allocator.allocate();
    allocator.allocate();
    allocator.reset();
    expect(allocator.allocate()).toBe(0);
    expect(allocator.peek()).toBe(1);
  });
});
