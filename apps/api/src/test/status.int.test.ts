import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());
beforeEach(async () => {
  await h.reset();
  await h.request("PUT", "/schedule", {
    blocks: [
      { weekday: 1, startTime: "09:00", endTime: "12:00" },
      { weekday: 1, startTime: "13:00", endTime: "17:00" },
      { weekday: 3, startTime: "10:00", endTime: "11:00" },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

// Only Date is faked: the server runs in this process, and faking timers would stall the DB socket.
const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
const MONDAY_10AM = "2026-11-09T10:00:00-08:00";

describe("/status", () => {
  it("is on inside a block, with the block and the next one", async () => {
    at(MONDAY_10AM);
    const { body } = await h.request("GET", "/status");
    expect(body).toMatchObject({
      on: true,
      scheduled: true,
      paused: false,
      manual: false,
      block: { weekday: 1, startTime: "09:00", endTime: "12:00" },
      nextBlock: { weekday: 1, startTime: "13:00", endTime: "17:00" },
      manualSession: null,
      break: null,
    });
  });

  it("is off between blocks", async () => {
    at("2026-11-09T12:30:00-08:00");
    const { body } = await h.request("GET", "/status");
    expect(body).toMatchObject({ on: false, scheduled: false, block: null, nextBlock: { startTime: "13:00" } });
  });

  it("reads a rest-of-day break from the database and skips today's next block", async () => {
    await h.sql(
      `INSERT INTO breaks (user_id, kind, started_at, ends_at) VALUES (1, 'rest_of_day', $1, $2)`,
      ["2026-11-09T09:30:00-08:00", "2026-11-10T00:00:00-08:00"],
    );
    at(MONDAY_10AM);
    const { body } = await h.request("GET", "/status");
    expect(body).toMatchObject({ on: false, scheduled: true, paused: true, nextBlock: { weekday: 3 } });
    expect(body.break).toMatchObject({ kind: "rest_of_day", endsAt: "2026-11-10T08:00:00.000Z" });
  });

  it("ignores a break that was ended early", async () => {
    await h.sql(
      `INSERT INTO breaks (user_id, kind, started_at, ends_at, ended_at) VALUES (1, 'rest_of_day', $1, $2, $3)`,
      ["2026-11-09T09:00:00-08:00", "2026-11-10T00:00:00-08:00", "2026-11-09T09:45:00-08:00"],
    );
    at(MONDAY_10AM);
    const { body } = await h.request("GET", "/status");
    expect(body).toMatchObject({ on: true, paused: false, break: null });
  });

  it("is on during a manual session outside the schedule", async () => {
    await h.sql(`INSERT INTO manual_sessions (user_id, started_at, ends_at) VALUES (1, $1, $2)`, [
      "2026-11-09T07:30:00-08:00",
      "2026-11-09T08:30:00-08:00",
    ]);
    at("2026-11-09T08:00:00-08:00");
    const { body } = await h.request("GET", "/status");
    expect(body).toMatchObject({ on: true, manual: true, scheduled: false });
    expect(body.manualSession.endsAt).toBe("2026-11-09T16:30:00.000Z");
  });
});
