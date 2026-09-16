import { describe, expect, it } from "vitest";
import { replay } from "./filter";

// 35-minute idle run, phone untouched on the desk, one sample every ~15s. Extracted from the log with:
//   grep -o 'RSSI: -[0-9]*' ~/rssi-idle.log | grep -o '\-[0-9]*' | paste -sd, -
const IDLE_LOG = [
  -43, -49, -42, -52, -45, -44, -44, -44, -46, -47, -41, -41, -46, -44, -69, -45, -50, -45, -49, -45,
  -46, -45, -46, -44, -44, -41, -42, -46, -44, -43, -45, -44, -44, -46, -46, -48, -50, -49, -47, -46,
  -50, -43, -51, -41, -47, -63, -40, -45, -46, -47, -50, -47, -43, -48, -45, -44, -49, -54, -44, -44,
  -44, -43, -42, -54, -50, -42, -43, -42, -43, -53, -46, -46, -52, -57, -53, -61, -49, -43, -50, -50,
  -43, -45, -44, -53, -51, -44, -53, -58, -43, -50, -41, -61, -53, -53, -44, -42, -45, -50, -49, -53,
  -45, -43, -45, -48, -46, -42, -53, -52, -47, -52, -47, -43, -41, -45, -49, -51, -44, -50, -45, -51,
  -52, -42, -50, -42, -43, -42, -47, -52, -54, -44, -43, -40, -51, -54, -42, -50, -43, -43,
];

const DESK = [-44, -43, -45, -44, -46, -42, -44, -45, -43, -44];
const AWAY = [-74, -73, -75, -74, -76, -72, -74, -75, -73, -74];
const DEAD_ZONE = Array<number>(20).fill(-60);

// A fresh filter commits an initial state, so every expectation below starts with that transition.
const presences = (samples: readonly number[]) => replay(samples).map((t) => t.presence);

describe("filter", () => {
  it("ignores the -69 spike recorded with the phone untouched on the desk", () => {
    // Settle at the desk first: nothing commits within five samples of a fresh filter, so the
    // spike on its own would pass without testing anything.
    expect(presences([...DESK, -46, -44, -69, -45, -50])).toEqual(["present"]);
  });

  it("commits nothing after startup across the whole idle log", () => {
    expect(IDLE_LOG).toHaveLength(138);
    expect(presences(IDLE_LOG)).toEqual(["present"]);
  });

  it("commits away on the 4th away sample of a real departure", () => {
    const transitions = replay([...DESK, ...AWAY]);

    expect(transitions.map((t) => t.presence)).toEqual(["present", "away"]);
    // Three away samples move the median of five, one more satisfies the debounce of two.
    // Earlier means the debounce isn't wired in; later means the window is off.
    expect(transitions[1]?.index).toBe(DESK.length + 3);
  });

  it("holds its state through a sustained reading between the thresholds", () => {
    expect(presences([...DESK, ...DEAD_ZONE])).toEqual(["present"]);
    expect(presences([...AWAY, ...DEAD_ZONE])).toEqual(["away"]);
  });
});
