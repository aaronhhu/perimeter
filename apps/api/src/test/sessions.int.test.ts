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
const at = (hhmm: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`2026-11-09T${hhmm}:00-08:00`));
};
const iso = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00-08:00`).toISOString();
const status = async () => (await h.request("GET", "/status")).body;
const insertBreak = (kind: "short" | "rest_of_day", start: string, end: string) =>
  h.sql(`INSERT INTO breaks (user_id, kind, started_at, ends_at) VALUES (1, $1, $2, $3)`, [kind, iso(start), end]);

describe("POST /sessions", () => {
  it("starts outside scheduled hours, timed by the server", async () => {
    at("07:00");
    const res = await h.request("POST", "/sessions", { minutes: 45 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startedAt: iso("07:00"), endsAt: iso("07:45") });
    expect(await status()).toMatchObject({ on: true, manual: true, scheduled: false });
  });

  it.each([4, 481, 30.5, "30", undefined])("rejects minutes = %s", async (minutes) => {
    at("07:00");
    expect((await h.request("POST", "/sessions", { minutes })).status).toBe(400);
    expect(await h.sql(`SELECT 1 FROM manual_sessions`)).toHaveLength(0);
  });

  it("accepts both ends of the range", async () => {
    at("07:00");
    expect((await h.request("POST", "/sessions", { minutes: 5 })).status).toBe(201);
    at("07:05");
    const res = await h.request("POST", "/sessions", { minutes: 480 });
    expect(res.status).toBe(201);
    expect(res.body.endsAt).toBe(iso("15:05"));
  });

  it("refuses inside scheduled hours (example: manual at 10:00, no pause)", async () => {
    at("10:00");
    expect(await h.request("POST", "/sessions", { minutes: 30 })).toMatchObject({
      status: 409,
      body: { code: "scheduled_hours" },
    });
  });

  it("refuses during a short break inside a block", async () => {
    await insertBreak("short", "09:20", iso("09:35"));
    at("09:25");
    expect((await h.request("POST", "/sessions", { minutes: 30 })).body.code).toBe("scheduled_hours");
  });

  it("starts inside scheduled hours once the day is paused, and the schedule stays off after", async () => {
    await insertBreak("rest_of_day", "10:00", "2026-11-10T00:00:00-08:00");
    at("10:30");
    expect((await h.request("POST", "/sessions", { minutes: 60 })).status).toBe(201);
    expect(await status()).toMatchObject({ on: true, manual: true, paused: true });
    at("11:31");
    expect(await status()).toMatchObject({ on: false, manual: false, paused: true });
  });

  it("refuses a second session while one runs, and allows one after it ends", async () => {
    at("07:00");
    await h.request("POST", "/sessions", { minutes: 30 });
    at("07:10");
    expect((await h.request("POST", "/sessions", { minutes: 30 })).body.code).toBe("session_running");
    at("07:30");
    expect((await h.request("POST", "/sessions", { minutes: 30 })).status).toBe(201);
    expect(await h.sql(`SELECT 1 FROM manual_sessions`)).toHaveLength(2);
  });

  it("lets a block start during a session normally (example: manual 08:00–09:30)", async () => {
    at("08:00");
    await h.request("POST", "/sessions", { minutes: 90 });
    at("09:15");
    expect(await status()).toMatchObject({ on: true, manual: true, scheduled: true });
    at("09:45");
    expect(await status()).toMatchObject({ on: true, manual: false, scheduled: true });
  });

  it("ends a leftover short break when starting", async () => {
    await insertBreak("short", "06:55", iso("07:10"));
    at("07:00");
    expect((await h.request("POST", "/sessions", { minutes: 30 })).status).toBe(201);
    expect(await status()).toMatchObject({ on: true, shortBreak: false, break: null });
  });
});

describe("POST /sessions/current/end", () => {
  it("is a 404 with nothing running", async () => {
    at("07:00");
    expect(await h.request("POST", "/sessions/current/end")).toMatchObject({ status: 404, body: { code: "no_session" } });
  });

  it("ends the session now", async () => {
    at("07:00");
    await h.request("POST", "/sessions", { minutes: 60 });
    at("07:20");
    const res = await h.request("POST", "/sessions/current/end");
    expect(res).toMatchObject({ status: 200, body: { endsAt: iso("08:00"), endedAt: iso("07:20") } });
    expect(await status()).toMatchObject({ on: false, manualSession: null });
    expect((await h.request("POST", "/sessions", { minutes: 10 })).status).toBe(201);
  });

  it("ends a short break that would otherwise outlive the session", async () => {
    at("07:00");
    await h.request("POST", "/sessions", { minutes: 60 });
    await insertBreak("short", "07:10", iso("07:25"));
    at("07:15");
    await h.request("POST", "/sessions/current/end");
    expect(await status()).toMatchObject({ break: null });
  });

  it("keeps a short break that's still pausing the schedule", async () => {
    at("08:30");
    await h.request("POST", "/sessions", { minutes: 60 });
    await insertBreak("short", "09:10", iso("09:25"));
    at("09:15");
    await h.request("POST", "/sessions/current/end");
    expect(await status()).toMatchObject({ on: false, scheduled: true, shortBreak: true, break: { kind: "short" } });
  });
});
