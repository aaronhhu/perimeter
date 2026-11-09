import { describe, expect, it } from "vitest";
import { END_TIME, START_TIME, blockAt, byWeekdayThenStart, findOverlaps, nextBlock, toClock } from "./schedule";

const block = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime });

describe("findOverlaps", () => {
  it("allows blocks that only touch at a boundary", () => {
    expect(findOverlaps([block(1, "09:00", "12:00"), block(1, "12:00", "17:00")])).toEqual([]);
  });

  it("finds a partial overlap on the same weekday", () => {
    expect(findOverlaps([block(1, "09:00", "12:00"), block(1, "11:30", "13:00")])).toEqual([[0, 1]]);
  });

  it("finds a block inside another", () => {
    expect(findOverlaps([block(1, "09:00", "17:00"), block(1, "10:00", "11:00")])).toEqual([[0, 1]]);
  });

  it("finds identical blocks", () => {
    expect(findOverlaps([block(3, "09:00", "10:00"), block(3, "09:00", "10:00")])).toEqual([[0, 1]]);
  });

  it("ignores the same hours on different weekdays", () => {
    expect(findOverlaps([block(1, "09:00", "17:00"), block(2, "09:00", "17:00")])).toEqual([]);
  });

  it("treats 24:00 as the end of the day", () => {
    expect(findOverlaps([block(5, "22:00", "24:00"), block(5, "23:00", "23:30")])).toEqual([[0, 1]]);
  });

  it("reports every overlapping pair, not just the first", () => {
    const blocks = [block(1, "09:00", "12:00"), block(1, "10:00", "11:00"), block(1, "11:30", "14:00")];
    expect(findOverlaps(blocks)).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });
});

describe("time formats", () => {
  it("allows 24:00 as an end but not a start", () => {
    expect(END_TIME.test("24:00")).toBe(true);
    expect(START_TIME.test("24:00")).toBe(false);
  });

  it("rejects malformed times", () => {
    for (const bad of ["9:00", "09:60", "25:00", "24:01", "09:00:00", ""]) {
      expect(END_TIME.test(bad), bad).toBe(false);
    }
  });

  it("drops seconds from Postgres times", () => {
    expect(toClock("09:30:00")).toBe("09:30");
    expect(toClock("24:00:00")).toBe("24:00");
  });
});

describe("byWeekdayThenStart", () => {
  it("sorts by weekday, then start", () => {
    const sorted = [block(2, "09:00", "10:00"), block(1, "13:00", "14:00"), block(1, "08:00", "09:00")].sort(
      byWeekdayThenStart,
    );
    expect(sorted).toEqual([block(1, "08:00", "09:00"), block(1, "13:00", "14:00"), block(2, "09:00", "10:00")]);
  });
});

describe("blockAt / nextBlock", () => {
  // Monday 09:00–12:00 and 13:00–17:00, Wednesday 10:00–11:00.
  const week = [block(1, "09:00", "12:00"), block(1, "13:00", "17:00"), block(3, "10:00", "11:00")];
  const at = (weekday: number, hhmm: string) => ({ weekday, secondOfDay: minutes(hhmm) * 60 });
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

  it("finds the covering block, half-open at the end", () => {
    expect(blockAt(week, at(1, "09:00"))).toEqual(week[0]);
    expect(blockAt(week, at(1, "11:59"))).toEqual(week[0]);
    expect(blockAt(week, at(1, "12:00"))).toBeNull();
  });

  it("finds the next block later the same day", () => {
    expect(nextBlock(week, at(1, "12:30"))).toEqual(week[1]);
  });

  it("doesn't count the running block as next", () => {
    expect(nextBlock(week, at(1, "09:00"))).toEqual(week[1]);
  });

  it("moves to a later weekday", () => {
    expect(nextBlock(week, at(1, "18:00"))).toEqual(week[2]);
  });

  it("wraps round the week", () => {
    expect(nextBlock(week, at(5, "12:00"))).toEqual(week[0]);
  });

  it("skips today's blocks when paused for the rest of the day", () => {
    expect(nextBlock(week, at(1, "10:00"), true)).toEqual(week[2]);
  });

  it("returns the same block next week when it's the only one", () => {
    const only = [block(1, "09:00", "10:00")];
    expect(nextBlock(only, at(1, "09:30"))).toEqual(only[0]);
    expect(nextBlock(only, at(1, "09:30"), true)).toEqual(only[0]);
  });

  it("returns null with no schedule", () => {
    expect(nextBlock([], at(1, "09:00"))).toBeNull();
  });
});
