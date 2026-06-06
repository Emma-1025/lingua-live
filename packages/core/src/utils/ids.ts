interface CryptoCapable {
  crypto?: { randomUUID?: () => string };
}

function randomId(): string {
  const crypto = (globalThis as CryptoCapable).crypto;
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Create a stable segment id that persists across partial → final updates. */
export function createSegmentId(): string {
  return randomId();
}

/** Create a stable session id for a new interpretation session. */
export function createSessionId(): string {
  return randomId();
}

/**
 * Allocates monotonically increasing spokenIndex values within a session.
 * spokenIndex is the chronological ordering key for subtitles and transcript.
 */
export class SpokenIndexAllocator {
  private nextIndex = 0;

  allocate(): number {
    const index = this.nextIndex;
    this.nextIndex += 1;
    return index;
  }

  peek(): number {
    return this.nextIndex;
  }

  reset(): void {
    this.nextIndex = 0;
  }
}
