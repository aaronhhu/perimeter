import { describe, expect, it } from "vitest";
import { parseDevices } from "./devices";

// Placeholder addresses only — real ones don't belong in the repo (docs/distribution.md).
const device = (address: string, extra: Record<string, string> = {}) => ({ device_address: address, ...extra });

const report = (buckets: Record<string, Array<Record<string, unknown>>>, state = "attrib_on"): string =>
  JSON.stringify({
    SPBluetoothDataType: [{ controller_properties: { controller_state: state }, ...buckets }],
  });

// The case this exists for: a replaced phone still paired, under the same name as the new one.
const SWAPPED_PHONES = report({
  device_connected: [{ "Aaron's AirPods": device("AA:BB:CC:DD:EE:03", { device_minorType: "Headphones" }) }],
  device_not_connected: [
    { "aarons iphone": device("AA:BB:CC:DD:EE:01", { device_minorType: "Mobile Phone", device_firmwareVersion: "24.1.0" }) },
    {
      "aarons iphone": device("AA:BB:CC:DD:EE:02", {
        device_minorType: "Mobile Phone",
        device_firmwareVersion: "26.6.0",
        device_rssi: "-41",
      }),
    },
  ],
});

describe("parseDevices", () => {
  it("lists every paired device across buckets, with what tells same-named phones apart", () => {
    const result = parseDevices(SWAPPED_PHONES);
    if (!result.ok) throw new Error(result.detail);

    expect(result.devices.map((d) => d.address)).toEqual(["AA:BB:CC:DD:EE:02", "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:03"]);
    expect(result.devices[0]).toEqual({
      name: "aarons iphone",
      address: "AA:BB:CC:DD:EE:02",
      kind: "Mobile Phone",
      firmware: "26.6.0",
      rssi: -41,
    });
    expect(result.devices[1]?.rssi).toBeNull();
  });

  it("puts phones first, live ones before silent ones", () => {
    const result = parseDevices(
      report({
        device_not_connected: [
          { Keyboard: device("AA:BB:CC:DD:EE:04", { device_rssi: "-30" }) },
          { "Old phone": device("AA:BB:CC:DD:EE:05", { device_minorType: "Mobile Phone" }) },
          { "New phone": device("AA:BB:CC:DD:EE:06", { device_minorType: "Mobile Phone", device_rssi: "-50" }) },
        ],
      }),
    );
    if (!result.ok) throw new Error(result.detail);
    expect(result.devices.map((d) => d.name)).toEqual(["New phone", "Old phone", "Keyboard"]);
  });

  it("lists a device once even if it shows up twice", () => {
    const result = parseDevices(
      report({
        device_connected: [{ Phone: device("AA:BB:CC:DD:EE:07") }],
        device_not_connected: [{ Phone: device("aa-bb-cc-dd-ee-07") }],
      }),
    );
    expect(result.ok && result.devices).toHaveLength(1);
  });

  it("returns an empty list, not a failure, when nothing is paired — the page explains how to pair", () => {
    expect(parseDevices(report({}))).toEqual({ ok: true, devices: [] });
  });

  it("reports Bluetooth off rather than an empty list", () => {
    expect(parseDevices(report({}, "attrib_off"))).toMatchObject({ ok: false, reason: "bluetooth-off" });
  });

  it("fails cleanly on output it can't read", () => {
    expect(parseDevices("not json")).toMatchObject({ ok: false, reason: "failed" });
    expect(parseDevices("{}")).toMatchObject({ ok: false, reason: "failed" });
  });
});
