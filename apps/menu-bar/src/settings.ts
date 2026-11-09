import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isBluetoothAddress } from "./env";

/**
 * Per-user settings for a downloaded copy, kept outside the app bundle (`app.getPath("userData")`,
 * i.e. ~/Library/Application Support/Perimeter/). Takes the directory so it stays testable without Electron.
 */
export interface Settings {
  readonly iphoneAddress: string | null;
}

const FILE = "settings.json";
const EMPTY: Settings = { iphoneAddress: null };

/** Missing or damaged reads as "no choice yet": the picker asks again, which is the right recovery either way. */
export async function readSettings(dir: string): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(join(dir, FILE), "utf8");
  } catch {
    return EMPTY;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const address =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["iphoneAddress"] : undefined;
    return { iphoneAddress: typeof address === "string" && isBluetoothAddress(address) ? address : null };
  } catch {
    return EMPTY;
  }
}

/** Write-then-rename, so a crash mid-write leaves the old file rather than half a new one. */
export async function saveSettings(dir: string, settings: Settings): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, FILE);
  await writeFile(`${path}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(`${path}.tmp`, path);
}
