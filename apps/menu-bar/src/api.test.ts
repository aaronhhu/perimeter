import { describe, expect, it, vi } from "vitest";
import { sendPresenceEvent } from "./api";
import type { PresenceEvent } from "./monitor";

const API = "http://localhost:3000";
const AT = new Date("2026-10-11T22:15:00.000Z");
const signal: PresenceEvent = { presence: "away", smoothed: -70, cause: "signal" };

describe("sendPresenceEvent", () => {
  it("posts the event with its timestamp to /presence-events", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 7 }, { status: 201 }));

    expect(await sendPresenceEvent(API, signal, AT, fetchImpl)).toEqual({ ok: true, id: 7 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/presence-events");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      presence: "away",
      smoothed: -70,
      cause: "signal",
      occurredAt: "2026-10-11T22:15:00.000Z",
    });
  });

  it("sends a blackout's smoothed as null, which the API accepts", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 8 }, { status: 201 }));
    await sendPresenceEvent(API, { presence: "unknown", smoothed: null, cause: "bluetooth_off" }, AT, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ smoothed: null, cause: "bluetooth_off" });
  });

  it("reports a rejection with the API's reasons rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "Invalid presence event" }, { status: 400 }));

    const result = await sendPresenceEvent(API, signal, AT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'HTTP 400: {"error":"Invalid presence event"}' });
  });

  it("reports an unreachable API rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    expect(await sendPresenceEvent(API, signal, AT, fetchImpl)).toEqual({ ok: false, reason: "fetch failed" });
  });
});
