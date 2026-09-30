import { INITIAL_STATE, step, DEFAULT_CONFIG, type FilterConfig, type FilterState, type Presence } from "./filter";
import { readRssi, DEFAULT_DEVICE, type DeviceMatcher, type Reading } from "./sampler";

export interface MonitorConfig {
  readonly pollIntervalMs: number;
  readonly dropoutSamples: number;
  readonly filter: FilterConfig;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  pollIntervalMs: 5_000,
  // Wall-clock, not polls: macOS echoes the last RSSI for 30–45s before dropping the field (9
  // repeats at 5s, which a 10s poll had made look like 3), so this counter only starts after that.
  // 6 × 5s holds the glitch tolerance at 30s — one slow system_profiler must not fire a nudge.
  dropoutSamples: 6,
  filter: DEFAULT_CONFIG,
};

/** Wider than `Presence`: the filter only ever argues present/away, but a blackout has no answer. */
export type ReportedPresence = Presence | "unknown";

export interface PresenceEvent {
  readonly presence: ReportedPresence;
  /** Null on a dropout: inventing a value would misreport a sensor failure as a reading. */
  readonly smoothed: number | null;
  readonly cause: "signal" | "dropout" | "cold-start" | "bluetooth-off";
}

export interface MonitorState {
  readonly filter: FilterState;
  readonly failures: number;
  readonly emitted: ReportedPresence | null;
  /** Distinct from `emitted !== null`: readings arrive for ~30s before the first verdict commits. */
  readonly seen: boolean;
}

export const INITIAL_MONITOR_STATE: MonitorState = {
  filter: INITIAL_STATE,
  failures: 0,
  emitted: null,
  seen: false,
};

export interface AdvanceResult {
  readonly state: MonitorState;
  readonly event: PresenceEvent | null;
}

/**
 * A dropout is never fed to the filter as a fake sample — a missing measurement is not a weak one,
 * and a floor value would let one flaky invocation drag the median toward away. Short dropouts are
 * skipped instead, leaving the window intact so a one-poll glitch costs nothing on recovery; a
 * sustained run of them (`dropoutSamples`) keeps the last verified state instead of assuming away.
 */
export function advance(state: MonitorState, reading: Reading, config: MonitorConfig): AdvanceResult {
  if (reading.ok) {
    const result = step(state.filter, reading.rssi, config.filter);
    const candidate: PresenceEvent | null =
      result.transition === null
        ? null
        : { presence: result.transition.presence, smoothed: result.transition.smoothed, cause: "signal" };

    return emit({ filter: result.state, failures: 0, emitted: state.emitted, seen: true }, candidate);
  }

  const failures = state.failures + 1;
  if (failures < config.dropoutSamples) {
    return emit({ filter: state.filter, failures, emitted: state.emitted, seen: state.seen }, null);
  }

  // Clear the window too: those samples predate the blackout, and letting them vote once readings
  // return would judge the present on stale evidence.
  const blacked = { filter: INITIAL_STATE, failures, emitted: state.emitted, seen: state.seen };

  // This Mac's own radio says nothing about where the phone is, so no prior state survives it.
  if (reading.reason === "bluetooth-off") {
    return emit(blacked, { presence: "unknown", smoothed: null, cause: "bluetooth-off" });
  }

  // Never having *seen* the phone, not never having committed a state: the first verdict takes 6
  // polls, and a phone that was plainly there and then went silent is a vanish however early it is.
  if (!state.seen) {
    return emit(blacked, { presence: "unknown", smoothed: null, cause: "cold-start" });
  }

  // A vanished phone looks the same whether it left or its Bluetooth was switched off, so the state
  // going in decides: walking away decays through `awayBelow` first and banks an `away`, while a
  // switch flipped at the desk jumps straight from a strong reading to silence. Anything not already
  // verified away is unresolved, not focus.
  return emit(blacked, {
    presence: state.emitted === "away" ? "away" : "unknown",
    smoothed: null,
    cause: "dropout",
  });
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
  /**
   * Drops the sliding window, keeping the last verified state. For waking from sleep: the loop is
   * frozen rather than failed, so no dropout is recorded and samples from hours ago would otherwise
   * sit in the window and outvote fresh ones. Same clear the dropout path does, and `emitted`
   * survives for the same reason it survives there — nothing about a gap says the phone moved.
   */
  reset(): void;
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
    reset() {
      state = { filter: INITIAL_STATE, failures: 0, emitted: state.emitted, seen: state.seen };
    },
  };
}
