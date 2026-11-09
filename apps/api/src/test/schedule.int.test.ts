import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());
beforeEach(() => h.reset());

const week = [
  { weekday: 3, startTime: "10:00", endTime: "11:00" },
  { weekday: 1, startTime: "13:00", endTime: "17:00" },
  { weekday: 1, startTime: "09:00", endTime: "12:00" },
  { weekday: 5, startTime: "22:00", endTime: "24:00" },
];

describe("/schedule", () => {
  it("starts empty", async () => {
    expect(await h.request("GET", "/schedule")).toEqual({ status: 200, body: { blocks: [] } });
  });

  it("round-trips times through Postgres, sorted, with 24:00 intact", async () => {
    const put = await h.request("PUT", "/schedule", { blocks: week });
    expect(put.status).toBe(200);
    expect(put.body.blocks).toEqual([week[2], week[1], week[0], week[3]]);
    expect((await h.request("GET", "/schedule")).body).toEqual(put.body);
  });

  it("replaces the whole week", async () => {
    await h.request("PUT", "/schedule", { blocks: week });
    await h.request("PUT", "/schedule", { blocks: [week[0]] });
    expect((await h.request("GET", "/schedule")).body.blocks).toEqual([week[0]]);
  });

  it("clears the week with an empty list", async () => {
    await h.request("PUT", "/schedule", { blocks: week });
    await h.request("PUT", "/schedule", { blocks: [] });
    expect((await h.request("GET", "/schedule")).body.blocks).toEqual([]);
  });

  it("keeps the old week when the new one is invalid", async () => {
    await h.request("PUT", "/schedule", { blocks: week });
    const bad = await h.request("PUT", "/schedule", {
      blocks: [
        { weekday: 1, startTime: "09:00", endTime: "12:00" },
        { weekday: 1, startTime: "11:00", endTime: "13:00" },
      ],
    });
    expect(bad.status).toBe(400);
    expect((await h.request("GET", "/schedule")).body.blocks).toHaveLength(week.length);
  });
});
