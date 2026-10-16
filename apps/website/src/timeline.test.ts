import { describe as group, expect, it } from "vitest";
import { axis, describe, floorHour, formatDuration, segments, totals, type PresenceEvent, type Timeline } from "./timeline";

// 2026-10-15 in America/Los_Angeles (PDT, UTC−7).
const day = (over: Partial<Timeline> = {}): Timeline => ({
  date: "2026-10-15",
  timezone: "America/Los_Angeles",
  start: "2026-10-15T07:00:00.000Z",
  end: "2026-10-16T07:00:00.000Z",
  now: "2026-10-15T20:00:00.000Z",
  before: null,
  events: [],
  quietSince: null,
  ...over,
});

let nextId = 1;
const ev = (occurredAt: string, presence: PresenceEvent["presence"], cause: PresenceEvent["cause"] = "signal"): PresenceEvent => ({
  id: nextId++,
  presence,
  cause,
  smoothed: cause === "signal" ? -60 : null,
  occurredAt,
});

const t = (iso: string) => Date.parse(iso);

group("segments", () => {
  it("holds each event until the next, and the last until now", () => {
    const segs = segments(
      day({ events: [ev("2026-10-15T16:00:00Z", "away"), ev("2026-10-15T18:00:00Z", "present")] }),
    );
    expect(segs).toEqual([
      { kind: "away", from: t("2026-10-15T16:00:00Z"), to: t("2026-10-15T18:00:00Z") },
      { kind: "present", from: t("2026-10-15T18:00:00Z"), to: t("2026-10-15T20:00:00Z") },
    ]);
  });

  it("starts the day in whatever state was in effect at midnight", () => {
    const segs = segments(day({ before: ev("2026-10-14T23:00:00Z", "away"), events: [ev("2026-10-15T09:00:00Z", "present")] }));
    expect(segs[0]).toEqual({ kind: "away", from: t("2026-10-15T07:00:00Z"), to: t("2026-10-15T09:00:00Z") });
  });

  it("shows a gap as offline, not as the sensor's unknown", () => {
    const segs = segments(
      day({
        events: [
          ev("2026-10-15T16:00:00Z", "away"),
          ev("2026-10-15T17:00:00Z", "unknown", "heartbeat_gap"),
          ev("2026-10-15T18:00:00Z", "away", "heartbeat_resume"),
        ],
      }),
    );
    expect(segs.map((s) => s.kind)).toEqual(["away", "offline", "away"]);
  });

  it("ends in offline when the Mac is quiet now and no gap row exists yet", () => {
    const segs = segments(day({ events: [ev("2026-10-15T16:00:00Z", "away")], quietSince: "2026-10-15T19:00:00Z" }));
    expect(segs.at(-1)).toEqual({ kind: "offline", from: t("2026-10-15T19:00:00Z"), to: t("2026-10-15T20:00:00Z") });
  });

  it("drops offline time before the first sign of life", () => {
    const segs = segments(
      day({
        before: ev("2026-10-14T23:00:00Z", "unknown", "heartbeat_gap"),
        events: [ev("2026-10-15T16:00:00Z", "away", "heartbeat_resume")],
      }),
    );
    expect(segs).toEqual([{ kind: "away", from: t("2026-10-15T16:00:00Z"), to: t("2026-10-15T20:00:00Z") }]);
  });

  it("is empty for a day the Mac never checked in", () => {
    expect(segments(day({ before: ev("2026-10-12T23:00:00Z", "away"), quietSince: "2026-10-12T23:10:00Z" }))).toEqual([]);
  });

  it("merges a resume that restates the state already in effect", () => {
    const segs = segments(
      day({ before: ev("2026-10-14T23:00:00Z", "away"), events: [ev("2026-10-15T10:00:00Z", "away", "heartbeat_resume")] }),
    );
    expect(segs).toHaveLength(1);
  });

  it("stops a past day at its own midnight", () => {
    const segs = segments(day({ events: [ev("2026-10-15T16:00:00Z", "away")], now: "2026-10-17T00:00:00Z" }));
    expect(segs.at(-1)?.to).toBe(t("2026-10-16T07:00:00Z"));
  });
});

group("totals", () => {
  it("sums time per kind", () => {
    const sum = totals(segments(day({ events: [ev("2026-10-15T16:00:00Z", "away"), ev("2026-10-15T18:30:00Z", "present")] })));
    expect(formatDuration(sum.away)).toBe("2h 30m");
    expect(formatDuration(sum.present)).toBe("1h 30m");
    expect(sum.unknown).toBe(0);
  });
});

group("floorHour", () => {
  it("uses the zone's hour, which differs from UTC's in half-hour zones", () => {
    expect(floorHour(t("2026-10-15T10:10:00Z"), "Asia/Kolkata")).toBe(t("2026-10-15T09:30:00Z"));
    expect(floorHour(t("2026-10-15T10:10:00Z"), "America/Los_Angeles")).toBe(t("2026-10-15T10:00:00Z"));
  });
});

group("axis", () => {
  it("spans whole hours around the data", () => {
    const a = axis([{ kind: "away", from: t("2026-10-15T16:20:00Z"), to: t("2026-10-15T18:05:00Z") }], "America/Los_Angeles");
    expect(a?.from).toBe(t("2026-10-15T16:00:00Z"));
    expect(a?.to).toBe(t("2026-10-15T19:00:00Z"));
    expect(a?.ticks).toHaveLength(4);
  });
});

group("describe", () => {
  it("tells the three sensor unknowns apart", () => {
    const titles = (["dropout", "cold_start", "bluetooth_off"] as const).map((c) => describe(ev("2026-10-15T16:00:00Z", "unknown", c)).title);
    expect(new Set(titles).size).toBe(3);
  });

  it("only asks about the phone's Bluetooth for a dropout", () => {
    expect(describe(ev("2026-10-15T16:00:00Z", "unknown", "dropout")).detail).toMatch(/Bluetooth off/);
    expect(describe(ev("2026-10-15T16:00:00Z", "unknown", "cold_start")).detail).not.toMatch(/Bluetooth/);
  });
});
