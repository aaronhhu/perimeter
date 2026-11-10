import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());
beforeEach(async () => {
  await h.reset();
  // Monday 09:00–17:00, as in ARCHITECTURE.md's worked examples.
  await h.request("PUT", "/schedule", { blocks: [{ weekday: 1, startTime: "09:00", endTime: "17:00" }] });
});
afterEach(() => {
  vi.useRealTimers();
});

// Only Date is faked: the server runs in this process, and faking timers would stall the DB socket.
const atIso = (when: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(when));
};
const at = (hhmm: string) => atIso(`2026-11-09T${hhmm}:00-08:00`);
const iso = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00-08:00`).toISOString();
const MIDNIGHT = "2026-11-10T08:00:00.000Z"; // Tuesday 00:00 PST

const status = async () => (await h.request("GET", "/status")).body;
const take = (kind: string) => h.request("POST", "/breaks", { kind });
const endBreak = () => h.request("POST", "/breaks/current/end");
const startSession = (minutes: number) => h.request("POST", "/sessions", { minutes });

describe("POST /breaks — short", () => {
  it("pauses the schedule for 15 minutes (example: short break 09:20)", async () => {
    at("09:20");
    const res = await take("short");
    expect(res).toMatchObject({ status: 201, body: { kind: "short", startedAt: iso("09:20"), endsAt: iso("09:35") } });
    expect(await status()).toMatchObject({ on: false, scheduled: true, shortBreak: true });
    at("09:35");
    expect(await status()).toMatchObject({ on: true, shortBreak: false, break: null });
  });

  it("pauses a manual session", async () => {
    at("07:00");
    await startSession(60);
    expect((await take("short")).status).toBe(201);
    expect(await status()).toMatchObject({ on: false, manual: true, shortBreak: true });
  });

  it("is refused with nothing to pause", async () => {
    at("07:00");
    expect(await take("short")).toMatchObject({ status: 409, body: { code: "nothing_to_pause" } });
  });

  it("is refused while one is already running", async () => {
    at("10:00");
    await take("short");
    at("10:05");
    expect((await take("short")).body.code).toBe("break_running");
  });

  it("is allowed during a manual session on a paused day", async () => {
    at("10:00");
    await take("rest_of_day");
    at("10:30");
    await startSession(60);
    at("10:40");
    expect((await take("short")).status).toBe(201);
    expect(await status()).toMatchObject({ on: false, manual: true, paused: true, shortBreak: true });
  });

  it("isn't blocked by an idle one left over from a session that ran out", async () => {
    at("07:00");
    await startSession(10);
    at("07:05");
    await take("short"); // runs to 07:20, past the session's 07:10 end
    at("07:12");
    expect((await take("short")).body.code).toBe("nothing_to_pause");
    expect((await status()).break).toBeNull();
  });
});

describe("POST /breaks — rest of the day", () => {
  it("pauses the schedule until local midnight", async () => {
    at("10:00");
    const res = await take("rest_of_day");
    expect(res).toMatchObject({ status: 201, body: { kind: "rest_of_day", startedAt: iso("10:00"), endsAt: MIDNIGHT } });
    expect(await status()).toMatchObject({ on: false, scheduled: true, paused: true });
  });

  it("can be taken before the day's hours (a day off)", async () => {
    at("07:00");
    await take("rest_of_day");
    at("09:30");
    expect(await status()).toMatchObject({ on: false, paused: true });
  });

  it("ends a running manual session", async () => {
    at("07:00");
    await startSession(120);
    at("07:30");
    await take("rest_of_day");
    expect(await status()).toMatchObject({ on: false, manual: false, manualSession: null });
    const [row] = await h.sql(`SELECT ended_at FROM manual_sessions`);
    expect(row.ended_at.toISOString()).toBe(iso("07:30"));
  });

  it("replaces a running short break", async () => {
    at("10:00");
    await take("short");
    at("10:05");
    expect((await take("rest_of_day")).status).toBe(201);
    expect(await status()).toMatchObject({ shortBreak: false, paused: true, break: { kind: "rest_of_day" } });
  });

  it("is refused while the day is already paused", async () => {
    at("10:00");
    await take("rest_of_day");
    expect((await take("rest_of_day")).body.code).toBe("break_running");
  });

  it("ends at the right midnight across a DST change", async () => {
    // Sunday 2026-03-08: clocks spring forward at 02:00, so that day is 23 hours long in Los Angeles.
    atIso("2026-03-08T10:00:00-07:00");
    expect((await take("rest_of_day")).body.endsAt).toBe("2026-03-09T07:00:00.000Z");
  });

  it("ends at midnight in the user's own timezone", async () => {
    await h.request("PATCH", "/me", { timezone: "Asia/Kolkata" });
    atIso("2026-11-09T10:00:00+05:30");
    expect((await take("rest_of_day")).body.endsAt).toBe("2026-11-09T18:30:00.000Z");
  });
});

describe("POST /breaks/current/end", () => {
  it("is a 404 with no break", async () => {
    at("10:00");
    expect(await endBreak()).toMatchObject({ status: 404, body: { code: "no_break" } });
  });

  it("returns early from a short break", async () => {
    at("10:00");
    await take("short");
    at("10:05");
    expect(await endBreak()).toMatchObject({ status: 200, body: { kind: "short", endedAt: iso("10:05") } });
    expect(await status()).toMatchObject({ on: true, shortBreak: false });
  });

  it("brings the schedule back (example: pause 10:00, ended 11:00)", async () => {
    at("10:00");
    await take("rest_of_day");
    at("11:00");
    await endBreak();
    expect(await status()).toMatchObject({ on: true, scheduled: true, paused: false });
  });

  it("steps back out one break at a time: short first, then the pause", async () => {
    at("10:00");
    await take("rest_of_day");
    at("10:30");
    await startSession(60);
    at("10:40");
    await take("short");
    at("10:45");
    expect((await endBreak()).body.kind).toBe("short");
    expect(await status()).toMatchObject({ on: true, manual: true, paused: true });
    expect((await endBreak()).body.kind).toBe("rest_of_day");
    expect(await status()).toMatchObject({ on: true, manual: true, scheduled: true, paused: false });
  });

  it("refuses a manual session again once the pause is ended, since the schedule is back", async () => {
    at("10:00");
    await take("rest_of_day");
    at("11:00");
    await endBreak();
    expect((await startSession(30)).body.code).toBe("scheduled_hours");
  });
});
