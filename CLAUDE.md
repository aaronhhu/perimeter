# Perimeter

Bluetooth proximity drives a focus/accountability session: the Mac senses how close the user's iPhone is. `present`/`away` describe the **phone**, not the user — focus means the phone is away during an active session. Menu bar app (Electron) + Express API (Postgres/Drizzle) + React website. No companion iOS app.

This file is the short list of things that are easy to get wrong. The rest lives elsewhere:

- **`ARCHITECTURE.md`** — how it works and why it was designed that way.
- **`docs/findings.md`** — dated test results and measurements, the evidence behind the rules here.

**Where new things go:** a test result goes in `docs/findings.md`, with its date and numbers. If it changes how code should be written, add the *rule* here in a line or two and point to the finding. Design goes in `ARCHITECTURE.md`. Don't record build progress here — it goes stale, and a stale line here gets trusted.

## Do not suggest these — tested and rejected

- **`blueutil --is-connected`, or any classic Bluetooth connection check.** iOS refuses a classic connection to a Mac, so it reads "not connected" at any distance, even touching the laptop.
- **Raw BLE scanning for the phone's address.** iOS rotates it about every 15 minutes, and the existing pairing already resolves it.
- **Wi-Fi presence (ping / ARP).** The range is the whole building; it can't tell the kitchen from the desk.

## The signal

The signal is the iPhone's RSSI from `system_profiler SPBluetoothDataType`, read from the BLE advertisements it broadcasts for Continuity. That's a one-way broadcast, not a connection.

- **Never unpair the iPhone, and never suggest it.** The pairing bond is what lets the Mac map the phone's rotating address back to this device. iOS suggests forgetting the device after a failed connection — don't, on either device.
- **A single raw sample must never change state.** A −69 was recorded with the phone untouched on the desk. Median smoothing plus debounce exists because of that sample.
- **Don't "optimize" away the detection latency** (~4 polls, 20s at 5s). It's the cost of not firing on noise.
- **The poll interval is 5s, on trial.** It still needs a 30+ minute run before it's final (`docs/findings.md`, 2026-09-29). Faster polling does *not* speed up the dropout path — the ~30–45s Bluetooth-off echo is wall-clock.
- **Don't build staleness detection** ("identical value for N polls"). A frozen value doesn't persist; the field drops out and becomes `rssi-absent`.
- **`rssi-absent` is ambiguous.** A phone out of range and a phone on the desk with Bluetooth off look identical. That's handled by the dropout rule below, not in the sampler.
- **`device-absent` never means distance.** The device list comes from pairing records, so a far-away phone is still listed. It means a wrong address or a broken pairing.
- **Thresholds are environment-specific** (one room, one Mac, one phone). They live in config.

## Presence states

- **A dropout keeps the last *verified* state.** Last verified `away` stays `away`; last verified `present` becomes `unknown` plus an "is Bluetooth off?" nudge. Built in `advance` (`apps/menu-bar/src/monitor.ts`).
- **`unknown` lives on `ReportedPresence`, not `Presence`.** The filter only ever argues present/away; don't widen its type.
- **`cold_start` and `bluetooth_off` are their own causes, not `dropout`.** Starting with the phone already in another room is the honest path and mustn't get the cheat's wording.
- **`cold_start` means never having *seen* the phone** (`MonitorState.seen`), not "no state committed yet". Readings arrive ~30s before the first verdict.
- **Unknown time never counts as focus.** Crediting an honest cold start is planned, not built (`ARCHITECTURE.md`, *Dropouts and unknown time*).

## API

- **The menu bar posts transitions immediately, plus a 60s heartbeat — never raw RSSI.** `smoothed` rides along as debug telemetry. Edge detection happens in the filter's debounce, never in the API.
- **All business logic lives in the API** — sessions, breaks, notification decisions, cooldowns. The one exception is signal conditioning, which is device physics and stays in the menu bar.
- **Every contact from the Mac goes through `recordContact`** (`apps/api/src/contact.ts`). That's what records heartbeat gaps. A new route that hears from the Mac must call it.
- **`heartbeat_gap` and `heartbeat_resume` are API-only causes.** `POST /presence-events` must keep rejecting them.
- **Request validation derives its enums from the Drizzle `pgEnum`s.** Never retype the values.
- **Pause is website-only on purpose.** The friction is the feature. Don't add a menu-bar pause shortcut.
- **Until auth exists, every route uses `CURRENT_USER_ID`** (`apps/api/src/currentUser.ts`).

## The menu bar shell

- **Electron is the shell and nothing more.** `sampler`/`filter`/`monitor` import no Electron API, so they stay testable and `pnpm dev` still runs the headless CLI. **Don't move signal logic into `main.ts`.**
- `pnpm start` bundles and launches the tray app; `pnpm dev` is the CLI; `pnpm icons` redraws the tray images.
- **The tray app logs every reading; the CLI only does with `PERIMETER_DEBUG=1`.** A tray app launched from a terminal is being watched; the CLI is what long runs pipe to a file.
- **Capture tuning runs with `2>&1 | tee run.log`.** Failed readings go to stderr, and without it they vanish from the file.
- **Waking from sleep calls `monitor.reset()`.** Otherwise samples from before sleep would still be voting in the window.
- **The tray images are generated** by `scripts/make-tray-icons.mjs`. Edit the script, not the PNGs. `Template` in the filename makes macOS treat the alpha as a mask; `@2x` is Retina.
- **`main.ts` is bundled with esbuild, not `tsc`** (tsc would leave extensionless imports unresolvable). It uses esbuild's JS API because pnpm's shim for `bin/esbuild` breaks after esbuild's postinstall.
- **A terminal inside VS Code or Claude Code inherits `ELECTRON_RUN_AS_NODE=1`,** which turns Electron into plain Node. `pnpm start` clears it.
- **The iPhone address is required, from `apps/menu-bar/.env`** (gitignored; `.env.example` has a placeholder). No default: a wrong address doesn't fail, it reads as `device-absent` forever. Never commit a real address.
- **API address:** `PERIMETER_API_URL`, default `http://localhost:3000`. A failed send is logged and dropped — retry is required before the API is hosted (`ARCHITECTURE.md`, *Core data flow*).

## Conventions

- **Comments explain why, not what.** Write one only for something the code can't show: where a tuned number came from, an approach that was tried and rejected, an empirical fact like the −69 spike. Keep it to a line or two.
- **pnpm, not npm.** pnpm reads `pnpm-workspace.yaml`, not the `workspaces` field.
- **pnpm 10 blocks postinstall scripts** unless the package is in `onlyBuiltDependencies`. Electron's postinstall downloads the binary; without it the install "succeeds" and `electron .` fails.
- `tsconfig.base.json` holds only genuinely shared options; `target`/`lib`/`module`/`moduleResolution` belong in each app's tsconfig.
- `noUncheckedIndexedAccess` is on deliberately — it forces the filter's partially-filled window to be handled.
- `moduleResolution: "Bundler"` in menu-bar, to avoid `.js` extensions on relative imports.
- **Schema changes go through `pnpm --filter @perimeter/api db:generate`, then `db:migrate`.** Never edit an applied migration.

## Not yet, on purpose

- **The `present` nudge fires on every arrival and repeats every 30s** (tray only). It's a stand-in until the API's `{ notify }` decides. Don't add session logic to the menu bar to make it smarter.
- **No `packages/shared-types`.** Create it when a type would otherwise be copy-pasted into a second app. Decide the consumption model then (see `ARCHITECTURE.md`, *Repo structure*).
- **Phase 2 (website blocking via `/etc/hosts`) is not started.** Don't build toward it.

## Working style

Explain the concept and the reasoning before the code. When there's a real tradeoff, state it plainly rather than picking silently.
