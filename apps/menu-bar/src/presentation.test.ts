import { describe, expect, it } from "vitest";
import type { PresenceEvent } from "./monitor";
import { iconName, nudgeFor, statusTitle, viewOf, type Status, type StatusView } from "./presentation";

const event = (over: Partial<PresenceEvent> = {}): PresenceEvent => ({
  presence: "unknown",
  smoothed: null,
  cause: "dropout",
  ...over,
});

describe("statusTitle", () => {
  it("tells the three unknowns apart", () => {
    const titles = (["bluetooth-off", "cold-start", "dropout"] as const).map((cause) =>
      statusTitle(viewOf(event({ cause }))),
    );
    expect(new Set(titles).size).toBe(3);
  });

  it("names this Mac, not the phone, when the Mac's own radio is off", () => {
    expect(statusTitle(viewOf(event({ cause: "bluetooth-off" })))).toMatch(/this Mac/);
  });
});

describe("iconName", () => {
  it("has a distinct icon for every status", () => {
    const statuses: Status[] = ["starting", "present", "away", "unknown"];
    const names = statuses.map((status) => iconName({ status, cause: null }));
    expect(new Set(names).size).toBe(statuses.length);
  });
});

describe("nudgeFor", () => {
  it("stays silent on present and away — whether those deserve a notification is the API's call", () => {
    expect(nudgeFor(event({ presence: "present", smoothed: -44, cause: "signal" }))).toBeNull();
    expect(nudgeFor(event({ presence: "away", smoothed: -72, cause: "signal" }))).toBeNull();
  });

  it("nudges on every unknown, since that is the case the sensor cannot resolve", () => {
    for (const cause of ["bluetooth-off", "cold-start", "dropout"] as const) {
      expect(nudgeFor(event({ cause }))).not.toBeNull();
    }
  });

  it("offers Bluetooth settings only when this Mac's radio is the thing to fix", () => {
    expect(nudgeFor(event({ cause: "bluetooth-off" }))?.offersBluetoothSettings).toBe(true);
    expect(nudgeFor(event({ cause: "dropout" }))?.offersBluetoothSettings).toBe(false);
    expect(nudgeFor(event({ cause: "cold-start" }))?.offersBluetoothSettings).toBe(false);
  });

  it("never blames the user's phone for the Mac's radio", () => {
    const view: StatusView = viewOf(event({ cause: "bluetooth-off" }));
    expect(statusTitle(view)).not.toMatch(/your phone/);
  });
});
