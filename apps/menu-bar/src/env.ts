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

/** No fallback: someone else's address doesn't fail, it reads as device-absent forever. */
export function deviceFromEnv(): DeviceMatcher | null {
  const address = process.env["PERIMETER_IPHONE_ADDRESS"]?.trim() ?? "";
  return ADDRESS.test(address) ? { address } : null;
}
