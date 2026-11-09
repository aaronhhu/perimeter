import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSettings, saveSettings } from "./settings";

const tempDir = () => mkdtemp(join(tmpdir(), "perimeter-settings-"));

describe("settings", () => {
  it("round-trips the chosen address, creating the folder on first save", async () => {
    const dir = join(await tempDir(), "Perimeter");
    await saveSettings(dir, { iphoneAddress: "AA:BB:CC:DD:EE:01" });
    expect(await readSettings(dir)).toEqual({ iphoneAddress: "AA:BB:CC:DD:EE:01" });
  });

  it("reads a missing file as no choice yet, which sends the user to the picker", async () => {
    expect(await readSettings(await tempDir())).toEqual({ iphoneAddress: null });
  });

  it("reads a damaged file or a bad address as no choice, rather than watching garbage forever", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "settings.json"), "{ half a fi");
    expect(await readSettings(dir)).toEqual({ iphoneAddress: null });

    await writeFile(join(dir, "settings.json"), JSON.stringify({ iphoneAddress: "my phone" }));
    expect(await readSettings(dir)).toEqual({ iphoneAddress: null });
  });
});
