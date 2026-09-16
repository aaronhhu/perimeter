import { describe, expect, it } from "vitest";
import { parseRssi, type DeviceMatcher } from "./sampler";

// Real `system_profiler SPBluetoothDataType -json` output from the development Mac, trimmed to the
// iPhone plus one RSSI-less device (so a matcher bug shows up as the wrong entry, not no entry),
// with serial numbers removed. Regenerate by running the command and pruning the same way.
const REAL_OUTPUT = String.raw`{
  "SPBluetoothDataType": [
    {
      "controller_properties": {
        "controller_address": "84:2F:57:2A:82:91",
        "controller_chipset": "BCM_4388C2",
        "controller_discoverable": "attrib_off",
        "controller_firmwareVersion": "22.2.143.1475",
        "controller_productID": "0x4A3B",
        "controller_state": "attrib_on",
        "controller_supportedServices": "0x392039 < HFP AVRCP A2DP HID Braille LEA AACP GATT SerialPort >",
        "controller_transport": "PCIe",
        "controller_vendorID": "0x004C (Apple)"
      },
      "device_not_connected": [
        {
          "Aar Pods": {
            "device_address": "74:65:0C:8A:C4:6E",
            "device_caseVersion": "1.9.4",
            "device_firmwareVersion": "6A321",
            "device_minorType": "Headphones",
            "device_productID": "0x200F",
            "device_vendorID": "0x004C"
          }
        },
        {
          "aarons iphone": {
            "device_address": "5C:50:D9:CF:E6:F4",
            "device_firmwareVersion": "26.6.0",
            "device_minorType": "Mobile Phone",
            "device_productID": "0x7507",
            "device_rssi": "-37",
            "device_vendorID": "0x004C"
          }
        }
      ]
    }
  ]
}`;

const IPHONE: DeviceMatcher = { address: "5C:50:D9:CF:E6:F4" };
const HEADPHONES: DeviceMatcher = { address: "74:65:0C:8A:C4:6E" };

interface DeviceProperties {
  device_address: string;
  device_rssi?: unknown;
}
interface Controller {
  controller_properties: Record<string, string>;
  device_not_connected: Array<Record<string, DeviceProperties>>;
}

const clone = (): { SPBluetoothDataType: Controller[] } => JSON.parse(REAL_OUTPUT);

const controllerOf = (output: { SPBluetoothDataType: Controller[] }): Controller => {
  const controller = output.SPBluetoothDataType[0];
  if (controller === undefined) throw new Error("fixture has no controller");
  return controller;
};

const iphoneIn = (output: { SPBluetoothDataType: Controller[] }): DeviceProperties => {
  for (const entry of controllerOf(output).device_not_connected) {
    for (const properties of Object.values(entry)) {
      if (properties.device_address === IPHONE.address) return properties;
    }
  }
  throw new Error("fixture no longer contains the iPhone");
};

/** For controller states the live Mac won't produce. */
const withController = (key: string, value: string): string => {
  const output = clone();
  controllerOf(output).controller_properties[key] = value;
  return JSON.stringify(output);
};

const withRssi = (value: unknown): string => {
  const output = clone();
  const iphone = iphoneIn(output);
  if (value === undefined) delete iphone.device_rssi;
  else iphone.device_rssi = value;
  return JSON.stringify(output);
};

describe("parseRssi", () => {
  it("reads the iPhone's RSSI out of real system_profiler output", () => {
    // device_rssi arrives as a string ("-37"), so this also covers the string-to-number conversion.
    expect(parseRssi(REAL_OUTPUT, IPHONE)).toEqual({ ok: true, rssi: -37 });
  });

  it("matches the address regardless of case and separators", () => {
    expect(parseRssi(REAL_OUTPUT, { address: "5c50d9cfe6f4" })).toEqual({ ok: true, rssi: -37 });
    expect(parseRssi(REAL_OUTPUT, { address: "5c-50-d9-cf-e6-f4" })).toEqual({ ok: true, rssi: -37 });
  });

  it("accepts a numeric device_rssi, in case a future macOS stops quoting it", () => {
    expect(parseRssi(withRssi(-44), IPHONE)).toEqual({ ok: true, rssi: -44 });
  });

  it("reports rssi-absent for a paired device that broadcasts no RSSI", () => {
    // The AirPods are in the same bucket as the phone — being listed is not the same as being sensed.
    expect(parseRssi(REAL_OUTPUT, HEADPHONES)).toMatchObject({ ok: false, reason: "rssi-absent" });
    expect(parseRssi(withRssi(undefined), IPHONE)).toMatchObject({ ok: false, reason: "rssi-absent" });
  });

  it("reports device-absent when the configured address isn't listed", () => {
    expect(parseRssi(REAL_OUTPUT, { address: "00:11:22:33:44:55" })).toMatchObject({
      ok: false,
      reason: "device-absent",
    });
  });

  it("reports bluetooth-off ahead of device-absent, since the radio explains the emptiness", () => {
    expect(parseRssi(withController("controller_state", "attrib_off"), IPHONE)).toMatchObject({
      ok: false,
      reason: "bluetooth-off",
    });
  });

  it("reports rssi-unparsable for a value that isn't a negative number", () => {
    for (const value of ["", "n/a", 0, 42, null]) {
      expect(parseRssi(withRssi(value), IPHONE)).toMatchObject({ ok: false, reason: "rssi-unparsable" });
    }
  });

  it("reports unparsable-output for anything that isn't the expected shape", () => {
    expect(parseRssi("not json", IPHONE)).toMatchObject({ ok: false, reason: "unparsable-output" });
    expect(parseRssi("{}", IPHONE)).toMatchObject({ ok: false, reason: "unparsable-output" });
    expect(parseRssi('{"SPBluetoothDataType":[]}', IPHONE)).toMatchObject({
      ok: false,
      reason: "unparsable-output",
    });
  });

  it("never throws, whatever it is handed", () => {
    for (const input of ["", "null", "[]", '{"SPBluetoothDataType":[null]}', "\u0000"]) {
      expect(() => parseRssi(input, IPHONE)).not.toThrow();
    }
  });
});
