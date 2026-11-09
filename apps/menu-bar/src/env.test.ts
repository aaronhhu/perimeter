import { afterEach, describe, expect, it } from "vitest";
import { addressFromEnv } from "./env";

const KEY = "PERIMETER_IPHONE_ADDRESS";
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("addressFromEnv", () => {
  it("tells unset from set from wrong — unset falls through to the saved phone, wrong must be reported", () => {
    delete process.env[KEY];
    expect(addressFromEnv()).toEqual({ kind: "unset" });

    process.env[KEY] = "  ";
    expect(addressFromEnv()).toEqual({ kind: "unset" });

    process.env[KEY] = "AA:BB:CC:DD:EE:01";
    expect(addressFromEnv()).toEqual({ kind: "set", device: { address: "AA:BB:CC:DD:EE:01" } });

    process.env[KEY] = "AA:BB:CC";
    expect(addressFromEnv()).toEqual({ kind: "invalid", value: "AA:BB:CC" });
  });
});
