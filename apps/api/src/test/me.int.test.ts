import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());
beforeEach(() => h.reset());

describe("/me", () => {
  it("returns the seeded user", async () => {
    const res = await h.request("GET", "/me");
    expect(res).toEqual({ status: 200, body: { name: "Test", timezone: "America/Los_Angeles", notifyIntervalS: 600 } });
  });

  it("updates one field and leaves the other", async () => {
    const res = await h.request("PATCH", "/me", { timezone: "Asia/Kolkata" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ timezone: "Asia/Kolkata", notifyIntervalS: 600 });
    expect((await h.request("GET", "/me")).body.timezone).toBe("Asia/Kolkata");
  });

  it("stores a zone Postgres can use for midnight", async () => {
    await h.request("PATCH", "/me", { timezone: "Asia/Kolkata" });
    const [row] = await h.sql(`SELECT (now() AT TIME ZONE timezone) IS NOT NULL AS ok FROM users`);
    expect(row.ok).toBe(true);
  });

  it("rejects an abbreviation and leaves the row alone", async () => {
    expect((await h.request("PATCH", "/me", { timezone: "PST" })).status).toBe(400);
    expect((await h.request("GET", "/me")).body.timezone).toBe("America/Los_Angeles");
  });
});
