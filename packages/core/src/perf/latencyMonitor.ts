import {
  DEFAULT_LATENCY_WINDOW_SIZE,
  LATENCY_WARNING_CLEAR_STABLE_MS,
  LATENCY_WARNING_RAISE_MAX_MS,
  LATENCY_WARNING_REMOVE_MAX_MS,
  LATENCY_WARNING_THRESHOLD_MS,
} from './constants.js';

export interface LatencySample {
  capturedAt: number;
  displayedAt: number;
  latencyMs: number;
}

export interface LatencyMonitorConfig {
  thresholdMs?: number;
  warningRaiseMaxMs?: number;
  warningClearStableMs?: number;
  warningRemoveMaxMs?: number;
  windowSize?: number;
  now?: () => number;
  setTimeoutFn?: ScheduleFn;
  clearTimeoutFn?: CancelScheduleFn;
}

export interface LatencyMonitor {
  recordPartial(capturedAt: number, displayedAt: number): void;
  getSamples(): readonly LatencySample[];
  getP95LatencyMs(): number | undefined;
  isWarningActive(): boolean;
  onWarningChange(handler: (active: boolean) => void): () => void;
  reset(): void;
}

type WarningChangeHandler = (active: boolean) => void;
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleFn = (fn: () => void, delayMs: number) => TimerHandle;
type CancelScheduleFn = (handle: TimerHandle) => void;

const defaultSchedule: ScheduleFn = (fn, delayMs) => globalThis.setTimeout(fn, delayMs);
const defaultCancelSchedule: CancelScheduleFn = (handle) => globalThis.clearTimeout(handle);

export class LatencyMonitorImpl implements LatencyMonitor {
  private readonly thresholdMs: number;
  private readonly warningRaiseMaxMs: number;
  private readonly warningClearStableMs: number;
  private readonly warningRemoveMaxMs: number;
  private readonly windowSize: number;
  private readonly now: () => number;
  private readonly schedule: ScheduleFn;
  private readonly cancelSchedule: CancelScheduleFn;
  private readonly samples: LatencySample[] = [];
  private readonly warningHandlers = new Set<WarningChangeHandler>();

  private warningActive = false;
  private stableLowSince: number | undefined;
  private raiseTimer: TimerHandle | undefined;
  private clearTimer: TimerHandle | undefined;
  private clearStableTimer: TimerHandle | undefined;

  constructor(config: LatencyMonitorConfig = {}) {
    this.thresholdMs = config.thresholdMs ?? LATENCY_WARNING_THRESHOLD_MS;
    this.warningRaiseMaxMs = config.warningRaiseMaxMs ?? LATENCY_WARNING_RAISE_MAX_MS;
    this.warningClearStableMs = config.warningClearStableMs ?? LATENCY_WARNING_CLEAR_STABLE_MS;
    this.warningRemoveMaxMs = config.warningRemoveMaxMs ?? LATENCY_WARNING_REMOVE_MAX_MS;
    this.windowSize = config.windowSize ?? DEFAULT_LATENCY_WINDOW_SIZE;
    this.now = config.now ?? (() => Date.now());
    this.schedule = config.setTimeoutFn ?? defaultSchedule;
    this.cancelSchedule = config.clearTimeoutFn ?? defaultCancelSchedule;
  }

  recordPartial(capturedAt: number, displayedAt: number): void {
    const latencyMs = displayedAt - capturedAt;
    this.samples.push({ capturedAt, displayedAt, latencyMs });
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }

    if (latencyMs > this.thresholdMs) {
      this.handleBreach(capturedAt);
      return;
    }

    this.handleHealthySample();
  }

  getSamples(): readonly LatencySample[] {
    return this.samples;
  }

  getP95LatencyMs(): number | undefined {
    if (this.samples.length === 0) {
      return undefined;
    }

    return percentile95(this.samples.map((sample) => sample.latencyMs));
  }

  isWarningActive(): boolean {
    return this.warningActive;
  }

  onWarningChange(handler: WarningChangeHandler): () => void {
    this.warningHandlers.add(handler);
    return () => {
      this.warningHandlers.delete(handler);
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.warningActive = false;
    this.stableLowSince = undefined;
    this.clearTimerHandle(this.raiseTimer);
    this.clearTimerHandle(this.clearTimer);
    this.clearTimerHandle(this.clearStableTimer);
    this.raiseTimer = undefined;
    this.clearTimer = undefined;
    this.clearStableTimer = undefined;
  }

  private handleBreach(capturedAt: number): void {
    this.stableLowSince = undefined;
    this.clearTimerHandle(this.clearTimer);
    this.clearTimer = undefined;
    this.clearTimerHandle(this.clearStableTimer);
    this.clearStableTimer = undefined;

    if (this.warningActive || this.raiseTimer !== undefined) {
      return;
    }

    const breachAt = capturedAt + this.thresholdMs;
    const raiseBy = breachAt + this.warningRaiseMaxMs;
    const delayMs = Math.max(0, raiseBy - this.now());
    this.raiseTimer = this.schedule(() => {
      this.raiseTimer = undefined;
      this.setWarningActive(true);
    }, delayMs);
  }

  private handleHealthySample(): void {
    this.clearTimerHandle(this.raiseTimer);
    this.raiseTimer = undefined;

    if (!this.warningActive) {
      return;
    }

    const p95 = this.getP95LatencyMs();
    const latest = this.samples.at(-1)?.latencyMs;
    if (p95 === undefined || latest === undefined || p95 > this.thresholdMs || latest > this.thresholdMs) {
      this.stableLowSince = undefined;
      this.clearTimerHandle(this.clearStableTimer);
      this.clearStableTimer = undefined;
      return;
    }

    if (this.stableLowSince === undefined) {
      this.stableLowSince = this.now();
    }

    if (this.clearStableTimer !== undefined) {
      return;
    }

    const stableConfirmedAt = this.stableLowSince + this.warningClearStableMs;
    const delayMs = Math.max(0, stableConfirmedAt - this.now());
    this.clearStableTimer = this.schedule(() => {
      this.clearStableTimer = undefined;
      this.scheduleWarningClear();
    }, delayMs);
  }

  private scheduleWarningClear(): void {
    if (!this.warningActive || this.clearTimer !== undefined) {
      return;
    }

    const removeBy = this.now() + this.warningRemoveMaxMs;
    const delayMs = Math.max(0, removeBy - this.now());
    this.clearTimer = this.schedule(() => {
      this.clearTimer = undefined;
      this.setWarningActive(false);
      this.stableLowSince = undefined;
    }, delayMs);
  }

  private setWarningActive(active: boolean): void {
    if (this.warningActive === active) {
      return;
    }

    this.warningActive = active;
    for (const handler of this.warningHandlers) {
      handler(active);
    }
  }

  private clearTimerHandle(handle: TimerHandle | undefined): void {
    if (handle !== undefined) {
      this.cancelSchedule(handle);
    }
  }
}

export function createLatencyMonitor(config: LatencyMonitorConfig = {}): LatencyMonitor {
  return new LatencyMonitorImpl(config);
}

export function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? sorted[sorted.length - 1]!;
}
