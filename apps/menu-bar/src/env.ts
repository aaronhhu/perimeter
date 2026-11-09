import type { DeviceMatcher } from "./sampler";

/** A missing file is fine: the variables can come from the shell instead. */
export function loadEnvFile(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export const MISSING_DEVICE =
  "PERIMETER_IPHONE_ADDRESS is missing or isn't a Bluetooth address. Copy apps/menu-bar/.env.example " +
  "to apps/menu-bar/.env and set it to your iPhone's Address from `system_profiler SPBluetoothDataType`.";

const ADDRESS = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;

export function isBluetoothAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}

/**
 * The tray app treats `.env` as a developer override of the address picked in the app, so it needs
 * to tell "not set" (fall through to the saved choice) from "set but wrong" (say so, don't guess).
 */
export type EnvAddress =
  | { readonly kind: "unset" }
  | { readonly kind: "invalid"; readonly value: string }
  | { readonly kind: "set"; readonly device: DeviceMatcher };

export function addressFromEnv(): EnvAddress {
  const value = process.env["PERIMETER_IPHONE_ADDRESS"]?.trim() ?? "";
  if (value === "") return { kind: "unset" };
  return ADDRESS.test(value) ? { kind: "set", device: { address: value } } : { kind: "invalid", value };
}

export const invalidEnvAddress = (value: string): string =>
  `PERIMETER_IPHONE_ADDRESS in apps/menu-bar/.env is "${value}", which isn't a Bluetooth address. ` +
  "Fix it, or delete the line to choose your iPhone from a list instead.";

/** The CLI has no window to pick in, so for it `.env` stays required. No fallback: someone else's address doesn't fail, it reads as device-absent forever. */
export function deviceFromEnv(): DeviceMatcher | null {
  const env = addressFromEnv();
  return env.kind === "set" ? env.device : null;
}
