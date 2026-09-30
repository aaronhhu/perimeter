import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./filter";
import {
  advance,
  DEFAULT_MONITOR_CONFIG,
  INITIAL_MONITOR_STATE,
  startMonitor,
  type MonitorConfig,
  type MonitorState,
  type PresenceEvent,
} from "./monitor";
import type { Reading } from "./sampler";

// Pinned rather than inherited: these cases assert the dropout policy, and the shipped count is a
// tuning value that moves with the poll interval.
const CONFIG: MonitorConfig = { ...DEFAULT_MONITOR_CONFIG, dropoutSamples: 3, filter: DEFAULT_CONFIG };

const ok = (rssi: number): Reading => ({ ok: true, rssi });
const dropout = (): Reading => ({ ok: false, reason: "rssi-absent", detail: "test" });
const macRadioOff = (): Reading => ({ ok: false, reason: "bluetooth-off", detail: "test" });

const DESK = [-44, -43, -45, -44, -46, -42, -44, -45, -43, -44];
const AWAY = [-74, -73, -75, -74, -76, -72, -74, -75, -73, -74];

function run(
  readings: readonly Reading[],
  config: MonitorConfig = CONFIG,
  from: MonitorState = INITIAL_MONITOR_STATE,
): { events: PresenceEvent[]; state: MonitorState; indices: number[] } {
  const events: PresenceEvent[] = [];
  const indices: number[] = [];
  let state = from;

  readings.forEach((reading, index) => {
    const result = advance(state, reading, config);
    state = result.state;
    if (result.event !== null) {
      events.push(result.event);
      indices.push(index);
    }
  });

  return { events, state, indices };
}

describe("advance", () => {
  it("emits present once the window fills, and never restates it", () => {
    const { events } = run(DESK.map(ok));
    expect(events).toEqual([{ presence: "present", smoothed: -44, cause: "signal" }]);
  });

  it("passes the filter's transitions through with their smoothed value", () => {
    const { events } = run([...DESK, ...AWAY].map(ok));
    expect(events.map((e) => e.presence)).toEqual(["present", "away"]);
    expect(events[1]).toMatchObject({ cause: "signal" });
    expect(typeof events[1]?.smoothed).toBe("number");
  });

  it("skips a brief dropout without disturbing the window", () => {
    // A skipped poll costs nothing on recovery: the window it had already built survives.
    const clean = run([...DESK, ...AWAY].map(ok));
    const glitched = run([...DESK.map(ok), dropout(), ...AWAY.map(ok)]);

    expect(glitched.events.map((e) => e.presence)).toEqual(clean.events.map((e) => e.presence));
    expect(glitched.indices[1]).toBe((clean.indices[1] ?? 0) + 1);
  });

  it("reports unknown, not away, when the phone vanishes straight from present", () => {
    // The one-tap cheat: Bluetooth off at the desk must not buy the focus credit that walking away does.
    const { events } = run([...DESK.map(ok), dropout(), dropout(), dropout()]);

    expect(events).toEqual([
      { presence: "present", smoothed: -44, cause: "signal" },
      { presence: "unknown", smoothed: null, cause: "dropout" },
    ]);
  });

  it("holds away when the phone vanishes after already being verified away", () => {
    const walked = run([...DESK, ...AWAY].map(ok));
    const { events, state } = run(Array.from({ length: 5 }, dropout), CONFIG, walked.state);

    expect(events).toEqual([]);
    expect(state.emitted).toBe("away");
  });

  it("reports unknown when the phone was never seen at all", () => {
    // A cold start with the phone already invisible has verified nothing, so it has earned nothing.
    const { events } = run(Array.from({ length: 3 }, dropout));
    expect(events).toEqual([{ presence: "unknown", smoothed: null, cause: "cold-start" }]);
  });

  it("calls it a vanish, not a cold start, when the phone was seen before the first verdict", () => {
    // Observed: five readings at -36 dBm, then Bluetooth off, one poll short of the first commit.
    // Keying the cold start off `emitted === null` gave the one-tap cheat a ~30s free window.
    const { events } = run([...DESK.slice(0, 5).map(ok), dropout(), dropout(), dropout()]);

    expect(events).toEqual([{ presence: "unknown", smoothed: null, cause: "dropout" }]);
  });

  it("separates a cold start from a vanish, so only the suspicious one can be accused", () => {
    // Identical state and identical lack of credit — but putting the phone in another room before
    // starting is the honest path, and must not draw the one-tap cheat's nudge.
    const cold = run(Array.from({ length: 3 }, dropout));
    const vanished = run([...DESK.map(ok), dropout(), dropout(), dropout()]);

    expect(cold.events.at(-1)).toMatchObject({ presence: "unknown", cause: "cold-start" });
    expect(vanished.events.at(-1)).toMatchObject({ presence: "unknown", cause: "dropout" });
  });

  it("reports unknown when this Mac's radio is off, whatever the last verified state was", () => {
    // Unlike a vanished phone, the Mac's own radio says nothing about distance, so away can't stand.
    const walked = run([...DESK, ...AWAY].map(ok));
    const { events } = run(Array.from({ length: 3 }, macRadioOff), CONFIG, walked.state);

    expect(events).toEqual([{ presence: "unknown", smoothed: null, cause: "bluetooth-off" }]);
  });

  it("recovers from unknown once the phone is readable again", () => {
    const blacked = run([...DESK.map(ok), dropout(), dropout(), dropout()]);
    expect(blacked.state.emitted).toBe("unknown");

    const { events } = run(DESK.map(ok), CONFIG, blacked.state);
    expect(events.map((e) => e.presence)).toEqual(["present"]);
  });

  it("commits the dropout exactly on the configured count, not before", () => {
    const short = run([...DESK.map(ok), dropout(), dropout()]);
    expect(short.events.map((e) => e.cause)).toEqual(["signal"]);

    const long = run([...DESK.map(ok), dropout(), dropout(), dropout()]);
    expect(long.indices[1]).toBe(DESK.length + CONFIG.dropoutSamples - 1);
  });

  it("announces a sustained dropout once, not every poll", () => {
    const { events } = run([...DESK.map(ok), ...Array.from({ length: 20 }, dropout)]);
    expect(events.filter((e) => e.cause === "dropout")).toHaveLength(1);
  });

  it("rebuilds the window from scratch after a dropout, rather than reusing pre-blackout samples", () => {
    const blacked = run([...DESK.map(ok), dropout(), dropout(), dropout()]);
    const recovery = run(DESK.map(ok), CONFIG, blacked.state);

    // The stale desk samples are gone, so present costs a full window again: the window fills at
    // index 4 (first judgement, debounce count 1), so index 5 commits.
    expect(recovery.events.map((e) => e.presence)).toEqual(["present"]);
    expect(recovery.indices[0]).toBe(5);
  });

  it("resets the dropout count on any usable reading", () => {
    const { state } = run([dropout(), dropout(), ok(-44)]);
    expect(state.failures).toBe(0);
  });
});

describe("startMonitor", () => {
  it("polls until stopped, scheduling from completion", async () => {
    const readings = [...DESK, ...AWAY].map(ok);
    const events: PresenceEvent[] = [];
    let polls = 0;
    let concurrent = 0;

    const monitor = startMonitor({
      config: { ...CONFIG, pollIntervalMs: 0 },
      read: async () => {
        concurrent += 1;
        expect(concurrent).toBe(1); // a fixed interval could overlap invocations; this must not
        await Promise.resolve();
        concurrent -= 1;
        const reading = readings[polls % readings.length];
        polls += 1;
        return reading ?? ok(-44);
      },
      onEvent: (event) => events.push(event),
    });

    while (events.length < 2 && polls < 100) await new Promise((resolve) => setTimeout(resolve, 1));
    monitor.stop();

    expect(events.map((e) => e.presence)).toEqual(["present", "away"]);

    const pollsAtStop = polls;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(polls).toBe(pollsAtStop);
  });

  it("keeps polling when an event handler throws", async () => {
    const errors: unknown[] = [];
    let polls = 0;

    const monitor = startMonitor({
      config: { ...CONFIG, pollIntervalMs: 0 },
      read: async () => {
        polls += 1;
        return ok(-44);
      },
      onEvent: () => {
        throw new Error("API unreachable");
      },
      onError: (error) => errors.push(error),
    });

    while (errors.length < 1 && polls < 100) await new Promise((resolve) => setTimeout(resolve, 1));
    const pollsAtError = polls;
    await new Promise((resolve) => setTimeout(resolve, 5));
    monitor.stop();

    expect(errors).toHaveLength(1);
    expect(polls).toBeGreaterThan(pollsAtError);
  });
});

describe("reset", () => {
  /** Drives the loop one reading at a time: an empty queue stalls the poll rather than inventing a sample. */
  function harness(config: MonitorConfig) {
    const queue: Reading[] = [];
    const events: PresenceEvent[] = [];
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const monitor = startMonitor({
      config: { ...config, pollIntervalMs: 0 },
      read: async () => {
        while (queue.length === 0) await tick();
        const reading = queue.shift();
        if (reading === undefined) throw new Error("queue emptied between the check and the shift");
        return reading;
      },
      onEvent: (event) => events.push(event),
    });

    const feed = async (...readings: readonly Reading[]) => {
      queue.push(...readings);
      while (queue.length > 0) await tick();
      await new Promise((resolve) => setTimeout(resolve, 2)); // let the last reading's event land
    };

    return { events, feed, monitor };
  }

  it("makes the filter rebuild a full window before it will argue again", async () => {
    const { events, feed, monitor } = harness(CONFIG);
    await feed(...DESK.slice(0, 6).map(ok));
    expect(events.map((e) => e.presence)).toEqual(["present"]);

    monitor.reset();
    // Four away samples would have outvoted the surviving desk window; against an empty one they
    // don't even fill it.
    await feed(...AWAY.slice(0, 4).map(ok));
    expect(events).toHaveLength(1);

    await feed(...AWAY.slice(4, 6).map(ok));
    expect(events.map((e) => e.presence)).toEqual(["present", "away"]);
    monitor.stop();
  });

  it("keeps the last verified state, so a dropout after it isn't mistaken for a cold start", async () => {
    const { events, feed, monitor } = harness(CONFIG);
    await feed(...DESK.slice(0, 6).map(ok));

    monitor.reset();
    await feed(...Array.from({ length: CONFIG.dropoutSamples }, dropout));

    expect(events[1]).toEqual({ presence: "unknown", smoothed: null, cause: "dropout" });
    monitor.stop();
  });
});
