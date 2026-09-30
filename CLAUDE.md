# Perimeter

Bluetooth proximity drives a focus/accountability session: the Mac senses how close the user's iPhone is. `present`/`away` describe the **phone**, not the user — focus means the phone is away during active hours. (Planned: also require recent keyboard/mouse activity via `HIDIdleTime`, so time away from the Mac doesn't count as focus.) Menu bar app + Express API + React website. No companion iOS app.

Full design rationale is in `ARCHITECTURE.md`. This file is the short list of things that are easy to get wrong.

## Do not suggest these — all three were tested and rejected

**`blueutil --is-connected`, or any classic Bluetooth connection check.** This is the obvious answer and it does not work. The iPhone *is* paired (it's listed in `blueutil --paired`), but iOS refuses a classic Bluetooth connection to a Mac — connecting from the iPhone fails with "'<Mac name>' is not supported". So `--is-connected` returns 0 permanently, at any distance, even with the phone touching the laptop. Connection state is useless; the pairing is not — see below.

**Raw BLE scanning for the phone's address.** iOS rotates its BLE MAC roughly every 15 minutes. Resolving it requires the identity resolving key from a bond. Not needed here — the existing pairing already gives the Mac that key. See below.

**Wi-Fi presence (ping / ARP table).** Range is the whole building. The mechanic needs desk-scale granularity; "phone is in the kitchen" must read as away, and Wi-Fi can't tell the kitchen from the desk.

## The actual signal

`system_profiler SPBluetoothDataType` reports an RSSI for the iPhone, read from the BLE advertisements it broadcasts continuously for Continuity. That's one-way broadcast, not a connection, which is why it works when `--is-connected` can't.

**Never unpair the iPhone, and never suggest it.** The pairing bond is what makes the RSSI usable: it supplies the identity resolving key that lets the Mac map the phone's rotating BLE address back to this specific device. Without it there's no stable identity to attach a reading to, and presence detection breaks. iOS suggests forgetting the device when a connection attempt fails — don't, on either device.

Verified over a 35-minute idle run (138 samples): values keep updating, no staleness, no drift. Measured ranges: at-desk −38 to −52, out-of-room −68 to −79, with a clean empty gap between.

Tuned parameters, validated by simulation against the real idle log (zero false transitions):

- Poll interval: 5s — provisional; the one value the idle log does *not* validate, see below
- Median window: 5 samples
- Debounce: 2 consecutive
- Present → Away below −65; Away → Present above −55

Detection latency is ~4 polls by design — 20s at 5s, 40s at 10s. Do not "optimize" this away — it's the cost of not firing on noise.

**The poll interval is 5s, on trial.** A 4-minute run at 5s (2026-09-29) cleared the one blocking question: `system_profiler` does refresh at that rate. Values changed on 63% of polls with runs of 1–3, nothing like the 3× duplication that would have made the median vote on one physical reading three times. Signal-path latency halved as intended — cold start and post-blackout recovery both confirmed `present` in 26s against 52s at 10s.

Two things it did *not* settle, and both want a 30+ minute run before 5s is called final:

- **A spike landing inside a hold.** Replaying the real −69 desk spike: held for 1 or 2 polls the filter absorbs it, held for 3 it commits a false `away`. The 5s run produced 3-runs but contained no spike (the 35-minute log had two, so 4 minutes is simply too short). The failure now needs both to coincide — a probability, not an impossibility.
- **Effective window shrinkage.** 21 distinct values across 33 polls is ~3.2 independent samples per 5-wide window, down from ~4.6 at 15s spacing.

Faster polling does *not* speed up the dropout path, so don't expect it to: freeze-to-nudge measured 56s at 5s against ~60s at 10s. The echo dominates and is wall-clock; only `dropoutSamples` scales.

**Stale RSSI resolved — no staleness detection needed.** Tested on both Wi-Fi and hotspot: with iPhone Bluetooth off, `system_profiler` keeps serving the last known RSSI, then drops the `device_rssi` field entirely, which the sampler already reports as `rssi-absent`. **The echo is wall-clock, not poll-count** — ~30–45s, seen as 9 identical repeats at a 5s poll; the earlier "~3 polls" was an artifact of only ever measuring at 10s. A frozen value still does not persist, so the planned "identical value for N consecutive polls" heuristic remains unnecessary — don't build it. Cost is latency: ~45s of stale repeats, then `dropoutSamples`, so ~75s total.

**`rssi-absent` is ambiguous, and that's the real loophole.** A phone out of range produces exactly the same `rssi-absent` as a phone on the desk with Bluetooth off — both halves now observed directly, not assumed. The symptom alone cannot tell genuine focus from gaming the session. See dropout handling below — the fix is not in the sampler.

**`device-absent` is not the way out of that, so don't reach for it.** The device list is built from pairing records, not from what's currently reachable: anything ever paired stays listed forever, which is why the AirPods sit in it with no `device_rssi` at all. A far-away phone is therefore still listed, and still `rssi-absent`. `device-absent` means a wrong address in config or a broken pairing — it can never mean distance. The whole entry is six fields (`device_address`, `device_firmwareVersion`, `device_minorType`, `device_productID`, `device_rssi`, `device_vendorID`): no timestamp, no last-seen, nothing else to infer from.

**A single raw sample must never change state.** A −69 was recorded with the phone sitting untouched on the desk, which is past the away threshold. Median smoothing plus debounce exists specifically because of that observed sample, not as a precaution.

That invariant is weaker at 5s than it was at 10s, and it's worth knowing why. A 30–45s frozen echo is 9 samples at 5s — enough to fill the 5-wide window completely, so the filter can commit a transition on what is physically one measurement. At 10s an echo was 3 samples and could never outvote the window. Harmless when the frozen value is deep in present territory, as observed; not harmless if a freeze ever captures a value near a threshold.

**Thresholds are environment-specific.** Calibrated to one room, one Mac, one phone. They live in config. A calibration flow is a known future need.

## Dropout handling

Distance is gradual, a switch is abrupt. Walking away decays the RSSI through −65 and confirms `away` *before* the signal vanishes; killing Bluetooth at the desk jumps from a strong reading straight to absent. The endpoint is ambiguous but the path into it is not, so a dropout keeps the last *verified* state:

- last verified `away` → stays `away`, counts as focus
- last verified `present` → `unknown` + "is Bluetooth off?" nudge

The nudge is the enforcement, not a fallback: the one case the sensor can't resolve gets handed to the user. Known false positive — leaving fast enough to go `present` → absent without ever confirming `away` earns a spurious nudge.

Built in `advance` (`apps/menu-bar/src/monitor.ts`). `unknown` lives on `ReportedPresence`, not on `Presence` — the filter argues present/away and nothing else, so widening its output type would invent a state it can never reach. A cold start and a Mac with its own Bluetooth off both skip the rule and go straight to `unknown`; neither has an `away` worth keeping.

Those two carry their own `cause` (`cold-start`, `bluetooth-off`) rather than `dropout`, because nothing disappeared in either — and starting a session with the phone already in another room is the *honest* path, probably the most common one. It must not draw the one-tap cheat's accusation. The state is the same and so is the absence of credit; only the wording changes. Turning a `cold-start` into credit can't come from the sensor at all — it needs the user to assert "it's in the other room", which belongs on the website next to pause.

**`cold-start` means never having *seen* the phone, not never having committed a state.** `MonitorState.seen` tracks that separately, because the first verdict takes 6 polls (~30s at 5s) and readings arrive long before it. Keying off `emitted === null` instead left a ~30s hole at launch where flipping Bluetooth off at the desk was reported as a cold start and drew the gentle message — observed with five readings at −36 dBm, then silence one poll short of the commit. A phone that was plainly there and then went quiet is a vanish however early it happens.

## The menu bar shell

Electron is the shell and nothing more. `sampler`/`filter`/`monitor` import no Electron API, so the
filter stays a pure function tested against the recorded RSSI log, and `pnpm dev` still runs the
headless CLI — that's what tuning runs use. **Don't move signal logic into `main.ts`.**

- `pnpm start` bundles and launches the tray app; `pnpm dev` is the CLI; `pnpm icons` redraws the tray images.
- **The tray app logs every reading; the CLI gates the same line behind `PERIMETER_DEBUG=1`.** Not an
  oversight: a packaged tray app has nowhere to print, so seeing it at all means someone launched it
  from a terminal to watch it. The CLI is the entry a long tuning run pipes to a file, where it would
  just be noise.
- **Waking from sleep calls `monitor.reset()`.** Sleep freezes the poll loop instead of failing it, so no
  dropout is recorded and samples from hours ago would otherwise still be in the window, voting.
- **The tray images are generated, not drawn** — `scripts/make-tray-icons.mjs` emits them from geometry
  written in 22pt units. Edit the script, not the PNGs. The `Template` in each filename is what tells
  macOS to use the alpha as a mask (so the icon inverts on a dark menu bar); `@2x` is the Retina variant.
- **`main.ts` is bundled with esbuild, not compiled with `tsc`.** That's the other half of
  `moduleResolution: "Bundler"` — tsc output would leave extensionless relative imports unresolvable.
  It runs through esbuild's JS API because esbuild's postinstall replaces `bin/esbuild` with a native
  executable, and a pnpm shim made before that still tries to run it through node.
- **Launching from a terminal inside another Electron app** (VS Code, Claude Code) inherits
  `ELECTRON_RUN_AS_NODE=1`, which makes the binary behave as plain Node — `require("electron")` then
  returns a path string and `app` is undefined. `pnpm start` clears it.

## Architecture rules

**The menu bar app posts presence *transitions* (immediately) plus a 60s heartbeat of the current state — never raw RSSI.** The API sees `present`/`away` events, optionally with a smoothed value as debug telemetry. Edge detection happens in the filter's debounce, so the API never has to detect edges itself.

**All business logic lives in the API** — active hours, break state, notification decisions, cooldowns. The one deliberate exception is signal conditioning (smoothing/hysteresis), which is device physics and per-machine calibration, not a rule, and runs at a 5s cadence.

**Pause is website-only on purpose.** The friction is the feature. Do not add a menu-bar pause shortcut.

## Conventions

- **Comments explain why, not what.** Don't narrate what the code does or restate an identifier in a doc comment — a reader has the code. Write one only for something the code can't show: where a tuned number came from, an approach that was tried and rejected, an empirical fact like the −69 spike. When one is warranted, keep it to a line or two.
- **pnpm, not npm.** pnpm ignores the `workspaces` field in `package.json` and reads `pnpm-workspace.yaml`.
- **pnpm 10 blocks postinstall scripts** unless the package is in `onlyBuiltDependencies`. Electron's postinstall is what downloads the actual binary, so without it the install reports success and `electron .` fails.
- `tsconfig.base.json` holds only genuinely shared options. `target`/`lib`/`module`/`moduleResolution` belong in each app's own tsconfig — they legitimately differ (Electron main is Node, website is DOM).
- `noUncheckedIndexedAccess` is on deliberately. The sliding-window filter indexes into a partially-filled array; this flag is what forces the startup case to be handled.
- `moduleResolution: "Bundler"` in menu-bar, chosen over `NodeNext` to avoid `.js` extensions on relative imports.

## Not yet, on purpose

- **No `apps/api` yet**, so the menu bar has no HTTP client and no 60s heartbeat — both halves of that contract get built together, against a real endpoint, rather than guessed at now. The seam is the `TODO` in `onEvent`, in both `index.ts` and `main.ts`.
- **No `packages/shared-types`.** Create it when a type would otherwise be copy-pasted into a second app, not before. When created, decide the consumption model: no-build `"types": "./src/index.ts"` works for Vite and bundlers but breaks a plain `tsc` build of the API.
- **Phase 2 (website blocking via `/etc/hosts`) is not started.** Don't build toward it yet.

## Working style

Explain the concept and the reasoning before the code. When there's a real tradeoff, state it plainly rather than picking silently.
