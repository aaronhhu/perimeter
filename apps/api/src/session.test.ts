import { describe, expect, it } from "vitest";
import { covers, localClock, sessionAt, type Break, type ManualSession, type SessionInputs } from "./session";

const TZ = "America/Los_Angeles";
const TUESDAY = 2;

// Tuesday 2026-11-03, PST (UTC−8): the first week after US daylight saving ended on Sunday 2026-11-01.
const tue = (time: string): Date => new Date(`2026-11-03T${time}-08:00`);
const midnightAfterTuesday = new Date("2026-11-04T00:00:00-08:00");

const schedule = [{ weekday: TUESDAY, startTime: "09:00:00", endTime: "12:00:00" }];

const inputs = (overrides: Partial<SessionInputs> = {}): SessionInputs => ({
  timezone: TZ,
  blocks: schedule,
  manualSessions: [],
  breaks: [],
  ...overrides,
});

const manual = (start: string, end: string, endedAt?: string): ManualSession => ({
  startedAt: tue(start),
  endsAt: tue(end),
  endedAt: endedAt === undefined ? null : tue(endedAt),
});

const shortBreak = (start: string, end: string, endedAt?: string): Break => ({
  kind: "short",
  startedAt: tue(start),
  endsAt: tue(end),
  endedAt: endedAt === undefined ? null : tue(endedAt),
});

const restOfDay = (start: string, endedAt?: string): Break => ({
  kind: "rest_of_day",
  startedAt: tue(start),
  endsAt: midnightAfterTuesday,
  endedAt: endedAt === undefined ? null : tue(endedAt),
});

describe("sessionAt — schedule", () => {
  it("is on inside a scheduled block", () => {
    expect(sessionAt(tue("10:00:00"), inputs())).toEqual({
      on: true,
      scheduled: true,
      paused: false,
      manual: false,
      shortBreak: false,
    });
  });

  it("covers the start of a block but not its end", () => {
    expect(sessionAt(tue("08:59:59"), inputs()).on).toBe(false);
    expect(sessionAt(tue("09:00:00"), inputs()).on).toBe(true);
    expect(sessionAt(tue("11:59:59"), inputs()).on).toBe(true);
    expect(sessionAt(tue("12:00:00"), inputs()).on).toBe(false);
  });

  it("only applies on its own weekday", () => {
    expect(sessionAt(new Date("2026-11-04T10:00:00-08:00"), inputs()).on).toBe(false);
  });

  it("is off with nothing scheduled or running", () => {
    expect(sessionAt(tue("10:00:00"), inputs({ blocks: [] })).on).toBe(false);
  });

  it("keeps 9:00 at 9:00 local across the daylight saving change", () => {
    const blocks = [
      { weekday: 5, startTime: "09:00:00", endTime: "12:00:00" }, // Friday, still PDT (UTC−7)
      { weekday: 1, startTime: "09:00:00", endTime: "12:00:00" }, // Monday, now PST (UTC−8)
    ];
    expect(sessionAt(new Date("2026-10-30T16:00:00Z"), inputs({ blocks })).on).toBe(true); // Fri 09:00 PDT
    expect(sessionAt(new Date("2026-10-30T15:59:59Z"), inputs({ blocks })).on).toBe(false);
    expect(sessionAt(new Date("2026-11-02T17:00:00Z"), inputs({ blocks })).on).toBe(true); // Mon 09:00 PST
    expect(sessionAt(new Date("2026-11-02T16:30:00Z"), inputs({ blocks })).on).toBe(false); // Mon 08:30 PST
  });

  it("treats 24:00 as the end of the day", () => {
    const blocks = [{ weekday: TUESDAY, startTime: "20:00:00", endTime: "24:00:00" }];
    expect(sessionAt(tue("23:59:59"), inputs({ blocks })).on).toBe(true);
    expect(sessionAt(midnightAfterTuesday, inputs({ blocks })).on).toBe(false);
  });
});

describe("sessionAt — short breaks", () => {
  it("pause the schedule while they run", () => {
    const state = sessionAt(tue("10:05:00"), inputs({ breaks: [shortBreak("10:00:00", "10:15:00")] }));
    expect(state).toMatchObject({ on: false, scheduled: true, shortBreak: true });
  });

  it("hand back at their end, not a moment later", () => {
    expect(sessionAt(tue("10:15:00"), inputs({ breaks: [shortBreak("10:00:00", "10:15:00")] })).on).toBe(true);
  });

  it("stop counting from when they were ended early", () => {
    const breaks = [shortBreak("10:00:00", "10:15:00", "10:05:00")];
    expect(sessionAt(tue("10:04:59"), inputs({ breaks })).on).toBe(false);
    expect(sessionAt(tue("10:05:00"), inputs({ breaks })).on).toBe(true);
  });

  it("pause a manual session too", () => {
    const state = sessionAt(
      tue("18:15:00"),
      inputs({ manualSessions: [manual("18:00:00", "19:00:00")], breaks: [shortBreak("18:10:00", "18:25:00")] }),
    );
    expect(state).toMatchObject({ on: false, manual: true, shortBreak: true });
  });

  it("don't extend the manual session they interrupt", () => {
    const at = tue("19:05:00");
    const state = sessionAt(
      at,
      inputs({ manualSessions: [manual("18:00:00", "19:00:00")], breaks: [shortBreak("18:10:00", "18:25:00")] }),
    );
    expect(state.on).toBe(false);
  });
});

describe("sessionAt — pausing the day", () => {
  it("switches the schedule off", () => {
    const state = sessionAt(tue("11:00:00"), inputs({ breaks: [restOfDay("10:00:00")] }));
    expect(state).toMatchObject({ on: false, scheduled: true, paused: true });
  });

  it("can be taken before the day's hours start", () => {
    expect(sessionAt(tue("10:00:00"), inputs({ breaks: [restOfDay("07:00:00")] })).on).toBe(false);
  });

  it("brings the schedule back when ended early", () => {
    expect(sessionAt(tue("10:30:00"), inputs({ breaks: [restOfDay("09:30:00", "10:00:00")] })).on).toBe(true);
  });

  it("lets a manual session started afterwards run", () => {
    const state = sessionAt(
      tue("11:00:00"),
      inputs({ breaks: [restOfDay("10:00:00")], manualSessions: [manual("10:30:00", "11:30:00")] }),
    );
    expect(state).toMatchObject({ on: true, paused: true, manual: true });
  });

  it("keeps the schedule off after that manual session ends early", () => {
    const state = sessionAt(
      tue("11:10:00"),
      inputs({ breaks: [restOfDay("10:00:00")], manualSessions: [manual("10:30:00", "11:30:00", "11:00:00")] }),
    );
    expect(state).toMatchObject({ on: false, scheduled: true, paused: true, manual: false });
  });
});

describe("sessionAt — manual sessions", () => {
  it("are on outside scheduled hours", () => {
    const state = sessionAt(tue("18:30:00"), inputs({ manualSessions: [manual("18:00:00", "19:00:00")] }));
    expect(state).toMatchObject({ on: true, scheduled: false, manual: true });
  });

  it("can run into a scheduled block without a gap or a conflict", () => {
    const manualSessions = [manual("08:30:00", "09:30:00")];
    expect(sessionAt(tue("08:45:00"), inputs({ manualSessions }))).toMatchObject({ on: true, manual: true });
    expect(sessionAt(tue("09:15:00"), inputs({ manualSessions }))).toMatchObject({
      on: true,
      manual: true,
      scheduled: true,
    });
    expect(sessionAt(tue("09:45:00"), inputs({ manualSessions }))).toMatchObject({
      on: true,
      manual: false,
      scheduled: true,
    });
  });

  it("stop at the moment they were ended early", () => {
    const manualSessions = [manual("18:00:00", "19:00:00", "18:20:00")];
    expect(sessionAt(tue("18:19:59"), inputs({ manualSessions })).on).toBe(true);
    expect(sessionAt(tue("18:20:00"), inputs({ manualSessions })).on).toBe(false);
  });
});

describe("covers", () => {
  it("never lets ended_at extend a range past ends_at", () => {
    const range = { startedAt: tue("10:00:00"), endsAt: tue("10:15:00"), endedAt: tue("10:30:00") };
    expect(covers(range, tue("10:20:00"))).toBe(false);
  });
});

describe("localClock", () => {
  it("reads the user's weekday and time, not UTC's", () => {
    // 07:59:59 UTC on Wednesday is still Tuesday evening in Los Angeles.
    expect(localClock(new Date("2026-11-04T07:59:59Z"), TZ)).toEqual({ weekday: TUESDAY, secondOfDay: 86_399 });
  });

  it("reports midnight as 0, not 24", () => {
    expect(localClock(midnightAfterTuesday, TZ)).toEqual({ weekday: 3, secondOfDay: 0 });
  });
});
