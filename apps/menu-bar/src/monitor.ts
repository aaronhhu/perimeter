import { INITIAL_STATE, step, DEFAULT_CONFIG, type FilterConfig, type FilterState, type Presence } from "./filter";
import { readRssi, DEFAULT_DEVICE, type DeviceMatcher, type Reading } from "./sampler";

export interface MonitorConfig {
  readonly pollIntervalMs: number;
  readonly dropoutSamples: number;
  readonly filter: FilterConfig;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  pollIntervalMs: 10_000,
  // 3 × 10s ≈ the ~40s latency of the signal path, so a dropout isn't a faster route to `away`.
  dropoutSamples: 3,
  filter: DEFAULT_CONFIG,
};

export interface PresenceEvent {
  readonly presence: Presence;
  /** Null on a dropout: inventing a value would misreport a sensor failure as a reading. */
  readonly smoothed: number | null;
  readonly cause: "signal" | "dropout";
}

export interface MonitorState {
  readonly filter: FilterState;
  readonly failures: number;
  readonly emitted: Presence | null;
}

export const INITIAL_MONITOR_STATE: MonitorState = {
  filter: INITIAL_STATE,
  failures: 0,
  emitted: null,
};

export interface AdvanceResult {
  readonly state: MonitorState;
  readonly event: PresenceEvent | null;
}

/**
 * A dropout is never fed to the filter as a fake sample — a missing measurement is not a weak one,
 * and a floor value would let one flaky invocation drag the median toward away. Short dropouts are
 * skipped instead, leaving the window intact so a one-poll glitch costs nothing on recovery; only a
 * sustained run of them (`dropoutSamples`) is treated as away in its own right.
 */
export function advance(state: MonitorState, reading: Reading, config: MonitorConfig): AdvanceResult {
  if (reading.ok) {
    const result = step(state.filter, reading.rssi, config.filter);
    const candidate: PresenceEvent | null =
      result.transition === null
        ? null
        : { presence: result.transition.presence, smoothed: result.transition.smoothed, cause: "signal" };

    return emit({ filter: result.state, failures: 0, emitted: state.emitted }, candidate);
  }

  const failures = state.failures + 1;
  if (failures < config.dropoutSamples) {
    return emit({ filter: state.filter, failures, emitted: state.emitted }, null);
  }

  // Clear the window too: those samples predate the blackout, and letting them vote once readings
  // return would judge the present on stale evidence.
  return emit(
    { filter: INITIAL_STATE, failures, emitted: state.emitted },
    { presence: "away", smoothed: null, cause: "dropout" },
  );
}

/** Suppresses a candidate that restates the current presence — the filter and the dropout path can both argue for `away`. */
function emit(state: MonitorState, candidate: PresenceEvent | null): AdvanceResult {
  if (candidate === null || candidate.presence === state.emitted) {
    return { state, event: null };
  }
  return { state: { ...state, emitted: candidate.presence }, event: candidate };
}

export interface MonitorHandle {
  stop(): void;
}

export interface MonitorOptions {
  readonly config?: MonitorConfig;
  readonly device?: DeviceMatcher;
  readonly read?: () => Promise<Reading>;
  readonly onEvent: (event: PresenceEvent) => void;
  /** Every poll, event or not. */
  readonly onReading?: (reading: Reading, state: MonitorState) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * The next poll is scheduled after the previous one *completes*, rather than on a `setInterval`.
 * The window size and debounce are tuned against evenly spaced samples, and a fixed interval can
 * overlap invocations if one runs slow — silently changing the spacing that tuning assumes.
 */
export function startMonitor(options: MonitorOptions): MonitorHandle {
  const config = options.config ?? DEFAULT_MONITOR_CONFIG;
  const device = options.device ?? DEFAULT_DEVICE;
  const read = options.read ?? (() => readRssi(device));

  let state = INITIAL_MONITOR_STATE;
  let stopped = false;
  let wake: (() => void) | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  // Callbacks reach out to the API eventually; one failure there must not end presence detection.
  const guard = (run: () => void) => {
    try {
      run();
    } catch (error) {
      options.onError?.(error);
    }
  };

  void (async () => {
    while (!stopped) {
      const reading = await read();
      if (stopped) break;

      const result = advance(state, reading, config);
      state = result.state;

      if (options.onReading !== undefined) {
        const snapshot = state;
        guard(() => options.onReading?.(reading, snapshot));
      }
      if (result.event !== null) {
        const event = result.event;
        guard(() => options.onEvent(event));
      }

      await sleep(config.pollIntervalMs);
    }
  })();

  return {
    stop() {
      stopped = true;
      wake?.();
    },
  };
}
