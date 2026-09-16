import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Matched on the bond identity address, not the display name — names are user-editable. */
export interface DeviceMatcher {
  readonly address: string;
}

export type DropoutReason =
  | "command-failed"
  | "unparsable-output"
  | "bluetooth-off"
  | "device-absent"
  | "rssi-absent"
  | "rssi-unparsable";

export type Reading =
  | { readonly ok: true; readonly rssi: number }
  | { readonly ok: false; readonly reason: DropoutReason; readonly detail: string };

/** Machine-specific, like the filter thresholds. `blueutil --paired` lists addresses. */
export const DEFAULT_DEVICE: DeviceMatcher = { address: "5C:50:D9:CF:E6:F4" };

const COMMAND = "system_profiler";
const ARGS = ["SPBluetoothDataType", "-json"];

/** Measured at 50–75ms per invocation; this is a hang guard, not a budget. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Never rejects: a dropout is a value the caller reasons about, and the poll loop must not die on it. */
export async function readRssi(
  device: DeviceMatcher,
  options: { readonly timeoutMs?: number } = {},
): Promise<Reading> {
  try {
    const { stdout } = await run(COMMAND, ARGS, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return parseRssi(stdout, device);
  } catch (error) {
    return { ok: false, reason: "command-failed", detail: errorMessage(error) };
  }
}

/**
 * Each controller holds one array per connection bucket (`device_connected`,
 * `device_not_connected`, …), each element mapping a display name to its properties. Every bucket is
 * searched: the iPhone sits in `device_not_connected` because iOS refuses a classic connection to a
 * Mac, but that's a fact about iOS, not something worth hard-coding a path around.
 */
export function parseRssi(stdout: string, device: DeviceMatcher): Reading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return { ok: false, reason: "unparsable-output", detail: errorMessage(error) };
  }

  const controllers = isRecord(parsed) ? parsed["SPBluetoothDataType"] : undefined;
  if (!Array.isArray(controllers) || controllers.length === 0) {
    return { ok: false, reason: "unparsable-output", detail: "no SPBluetoothDataType array in output" };
  }

  const wanted = normalizeAddress(device.address);
  if (wanted === "") {
    return { ok: false, reason: "device-absent", detail: `not a Bluetooth address: ${device.address}` };
  }

  // Bluetooth being off also empties the device buckets, so check it first or the reason comes back
  // as the much less useful "device-absent".
  for (const controller of controllers) {
    if (!isRecord(controller)) continue;
    const properties = controller["controller_properties"];
    if (!isRecord(properties)) continue;
    const state = properties["controller_state"];
    if (typeof state === "string" && state !== "attrib_on") {
      return { ok: false, reason: "bluetooth-off", detail: `controller_state: ${state}` };
    }
  }

  for (const controller of controllers) {
    if (!isRecord(controller)) continue;
    for (const [bucket, entries] of Object.entries(controller)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        for (const [name, properties] of Object.entries(entry)) {
          if (!isRecord(properties)) continue;
          const address = properties["device_address"];
          if (typeof address !== "string" || normalizeAddress(address) !== wanted) continue;
          return rssiOf(properties, name, bucket);
        }
      }
    }
  }

  return { ok: false, reason: "device-absent", detail: `no device with address ${device.address}` };
}

function rssiOf(properties: Record<string, unknown>, name: string, bucket: string): Reading {
  const raw = properties["device_rssi"];
  if (raw === undefined) {
    return { ok: false, reason: "rssi-absent", detail: `"${name}" is listed under ${bucket} without an RSSI` };
  }

  // A string today ("-42"). Numbers are accepted too, so a future macOS changing that isn't an outage.
  const rssi = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(rssi) || rssi >= 0) {
    return { ok: false, reason: "rssi-unparsable", detail: `device_rssi was ${JSON.stringify(raw)}` };
  }

  return { ok: true, rssi };
}

function normalizeAddress(address: string): string {
  return address.replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
