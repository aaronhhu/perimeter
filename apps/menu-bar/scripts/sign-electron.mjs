// Re-signs the Electron binary pnpm downloads, run as `postinstall` because every reinstall restores it.
//
// It ships linker-signed with its Info.plist unbound, and macOS refuses that app's notifications
// outright (UNErrorDomain error 1) — no prompt, no System Settings entry, and the toggle doesn't help
// once it appears. An ad-hoc re-sign binds the Info.plist, which is all it takes. A packaged, properly
// signed build won't need this.

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

if (process.platform !== "darwin") process.exit(0);

// Under plain Node, `require("electron")` is the path to the executable inside Electron.app/Contents/MacOS.
const executable = createRequire(import.meta.url)("electron");
const bundle = dirname(dirname(dirname(executable)));

// codesign prints its details to stderr.
const details = spawnSync("codesign", ["-dv", bundle], { encoding: "utf8" }).stderr;
if (!details.includes("Info.plist=not bound")) process.exit(0);

execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "inherit" });
console.log(`Re-signed ${bundle} so macOS will show its notifications.`);
