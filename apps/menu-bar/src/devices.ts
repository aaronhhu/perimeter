import type { DeviceList, PairedDevice } from "./pickerApi";
import { bluetoothOffState, bluetoothReport, errorMessage, isRecord, normalizeAddress } from "./sampler";

/** Never rejects, for the same reason `readRssi` doesn't: the picker shows a failure, it doesn't crash. */
export async function listPairedDevices(): Promise<DeviceList> {
  try {
    return parseDevices(await bluetoothReport());
  } catch (error) {
    return { ok: false, reason: "failed", detail: errorMessage(error) };
  }
}

/**
 * Every device in every bucket. The list comes from pairing records, so a phone only appears once it's
 * been paired with this Mac — and a phone that was replaced still appears, usually under the same name.
 */
export function parseDevices(stdout: string): DeviceList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return { ok: false, reason: "failed", detail: errorMessage(error) };
  }

  const controllers = isRecord(parsed) ? parsed["SPBluetoothDataType"] : undefined;
  if (!Array.isArray(controllers) || controllers.length === 0) {
    return { ok: false, reason: "failed", detail: "no SPBluetoothDataType array in output" };
  }

  const off = bluetoothOffState(controllers);
  if (off !== null) return { ok: false, reason: "bluetooth-off", detail: `controller_state: ${off}` };

  const byAddress = new Map<string, PairedDevice>();
  for (const controller of controllers) {
    if (!isRecord(controller)) continue;
    for (const entries of Object.values(controller)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        for (const [name, properties] of Object.entries(entry)) {
          if (!isRecord(properties)) continue;
          const address = properties["device_address"];
          if (typeof address !== "string" || normalizeAddress(address) === "") continue;
          const key = normalizeAddress(address);
          if (byAddress.has(key)) continue;
          byAddress.set(key, {
            name,
            address,
            kind: stringOrNull(properties["device_minorType"]),
            firmware: stringOrNull(properties["device_firmwareVersion"]),
            rssi: rssiOrNull(properties["device_rssi"]),
          });
        }
      }
    }
  }

  return { ok: true, devices: [...byAddress.values()].sort(byLikelyPhone) };
}

/** Phones first, then whatever is broadcasting right now, then by name. */
function byLikelyPhone(a: PairedDevice, b: PairedDevice): number {
  const phone = (d: PairedDevice): number => (d.kind === "Mobile Phone" ? 0 : 1);
  const live = (d: PairedDevice): number => (d.rssi === null ? 1 : 0);
  return phone(a) - phone(b) || live(a) - live(b) || a.name.localeCompare(b.name);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Same acceptance rule as the sampler's: arrives as a string today, numbers tolerated. */
function rssiOrNull(raw: unknown): number | null {
  const rssi = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  return Number.isFinite(rssi) && rssi < 0 ? rssi : null;
}
