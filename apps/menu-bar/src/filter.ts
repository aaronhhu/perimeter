export type Presence = "present" | "away";

export interface FilterConfig {
  /** Must be odd, so the median is always a real sample. */
  readonly windowSize: number;
  readonly debounce: number;
  readonly awayBelow: number;
  readonly presentAbove: number;
}

/** Calibrated to one room, one Mac, one phone. Other environments need their own values. */
export const DEFAULT_CONFIG: FilterConfig = {
  windowSize: 5,
  debounce: 2,
  awayBelow: -65,
  presentAbove: -55,
};

export interface FilterState {
  readonly samples: readonly number[];
  readonly presence: Presence | null;
  readonly pending: { readonly presence: Presence; readonly count: number } | null;
}

export const INITIAL_STATE: FilterState = { samples: [], presence: null, pending: null };

export interface Transition {
  readonly presence: Presence;
  readonly smoothed: number;
}

export interface StepResult {
  readonly state: FilterState;
  readonly smoothed: number | null;
  readonly transition: Transition | null;
}

export function step(state: FilterState, sample: number, config: FilterConfig): StepResult {
  assertValidConfig(config);
  if (!Number.isFinite(sample)) {
    throw new RangeError(`RSSI sample must be a finite number, got ${sample}`);
  }

  const samples = [...state.samples, sample].slice(-config.windowSize);

  // Never judge a partial window, or the first couple of samples alone could set the state.
  if (samples.length < config.windowSize) {
    return { state: { ...state, samples }, smoothed: null, transition: null };
  }

  const smoothed = median(samples);
  const target = targetPresence(smoothed, state.presence, config);

  if (target === null) {
    return { state: { samples, presence: state.presence, pending: null }, smoothed, transition: null };
  }

  const count = state.pending?.presence === target ? state.pending.count + 1 : 1;

  if (count < config.debounce) {
    return {
      state: { samples, presence: state.presence, pending: { presence: target, count } },
      smoothed,
      transition: null,
    };
  }

  return {
    state: { samples, presence: target, pending: null },
    smoothed,
    transition: { presence: target, smoothed },
  };
}

export function replay(
  samples: readonly number[],
  config: FilterConfig = DEFAULT_CONFIG,
): Array<Transition & { readonly index: number }> {
  const transitions: Array<Transition & { readonly index: number }> = [];
  let state = INITIAL_STATE;

  samples.forEach((sample, index) => {
    const result = step(state, sample, config);
    state = result.state;
    if (result.transition !== null) {
      transitions.push({ index, ...result.transition });
    }
  });

  return transitions;
}

/** Null in the dead zone between the two thresholds — that's the hysteresis. */
function targetPresence(smoothed: number, current: Presence | null, config: FilterConfig): Presence | null {
  const argued: Presence | null =
    smoothed < config.awayBelow ? "away" : smoothed > config.presentAbove ? "present" : null;
  return argued === current ? null : argued;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) {
    throw new Error("median of an empty window");
  }
  return middle;
}

function assertValidConfig({ windowSize, debounce, awayBelow, presentAbove }: FilterConfig): void {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize % 2 === 0) {
    throw new RangeError(`windowSize must be a positive odd integer, got ${windowSize}`);
  }
  if (!Number.isInteger(debounce) || debounce < 1) {
    throw new RangeError(`debounce must be a positive integer, got ${debounce}`);
  }
  if (!(awayBelow < presentAbove)) {
    throw new RangeError(
      `awayBelow (${awayBelow}) must be lower than presentAbove (${presentAbove}), or the state will oscillate`,
    );
  }
}
