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

- Poll interval: 10s
- Median window: 5 samples
- Debounce: 2 consecutive
- Present → Away below −65; Away → Present above −55

Detection latency is ~40s by design. Do not "optimize" this away — it's the cost of not firing on noise.

**Stale RSSI resolved — no staleness detection needed.** Tested on both Wi-Fi and hotspot: with iPhone Bluetooth off, `system_profiler` keeps serving the last known RSSI for ~3 polls, then drops the `device_rssi` field entirely, which the sampler already reports as `rssi-absent`. A frozen value does not persist, so the planned "identical value for N consecutive polls" heuristic is unnecessary — don't build it. Cost is latency: ~30s of stale repeats, then `dropoutSamples` before the dropout path fires, so ~60s total.

**`rssi-absent` is ambiguous, and that's the real loophole.** A phone out of range produces exactly the same `rssi-absent` as a phone on the desk with Bluetooth off. The symptom alone cannot tell genuine focus from gaming the session. See dropout handling below — the fix is not in the sampler.

**A single raw sample must never change state.** A −69 was recorded with the phone sitting untouched on the desk, which is past the away threshold. Median smoothing plus debounce exists specifically because of that observed sample, not as a precaution.

**Thresholds are environment-specific.** Calibrated to one room, one Mac, one phone. They live in config. A calibration flow is a known future need.

## Dropout handling

Distance is gradual, a switch is abrupt. Walking away decays the RSSI through −65 and confirms `away` *before* the signal vanishes; killing Bluetooth at the desk jumps from a strong reading straight to absent. The endpoint is ambiguous but the path into it is not, so a dropout keeps the last *verified* state:

- last verified `away` → stays `away`, counts as focus
- last verified `present` → `unknown` + "is Bluetooth off?" nudge

The nudge is the enforcement, not a fallback: the one case the sensor can't resolve gets handed to the user. Known false positive — leaving fast enough to go `present` → absent without ever confirming `away` earns a spurious nudge.

Built in `advance` (`apps/menu-bar/src/monitor.ts`). `unknown` lives on `ReportedPresence`, not on `Presence` — the filter argues present/away and nothing else, so widening its output type would invent a state it can never reach. A cold start and a Mac with its own Bluetooth off both skip the rule and go straight to `unknown`; neither has an `away` worth keeping.

## Architecture rules

**The menu bar app posts presence *transitions* (immediately) plus a 60s heartbeat of the current state — never raw RSSI.** The API sees `present`/`away` events, optionally with a smoothed value as debug telemetry. Edge detection happens in the filter's debounce, so the API never has to detect edges itself.

**All business logic lives in the API** — active hours, break state, notification decisions, cooldowns. The one deliberate exception is signal conditioning (smoothing/hysteresis), which is device physics and per-machine calibration, not a rule, and runs at a 10s cadence.

**Pause is website-only on purpose.** The friction is the feature. Do not add a menu-bar pause shortcut.

## Conventions

- **Comments explain why, not what.** Don't narrate what the code does or restate an identifier in a doc comment — a reader has the code. Write one only for something the code can't show: where a tuned number came from, an approach that was tried and rejected, an empirical fact like the −69 spike. When one is warranted, keep it to a line or two.
- **pnpm, not npm.** pnpm ignores the `workspaces` field in `package.json` and reads `pnpm-workspace.yaml`.
- `tsconfig.base.json` holds only genuinely shared options. `target`/`lib`/`module`/`moduleResolution` belong in each app's own tsconfig — they legitimately differ (Electron main is Node, website is DOM).
- `noUncheckedIndexedAccess` is on deliberately. The sliding-window filter indexes into a partially-filled array; this flag is what forces the startup case to be handled.
- `moduleResolution: "Bundler"` in menu-bar, chosen over `NodeNext` to avoid `.js` extensions on relative imports.

## Not yet, on purpose

- **No Electron.** `apps/menu-bar` is a plain TS CLI until the filter is correct. The filter is a pure function over numbers and is tested against the recorded RSSI log; an Electron tray icon can't be tested that way.
- **No `packages/shared-types`.** Create it when a type would otherwise be copy-pasted into a second app, not before. When created, decide the consumption model: no-build `"types": "./src/index.ts"` works for Vite and bundlers but breaks a plain `tsc` build of the API.
- **Phase 2 (website blocking via `/etc/hosts`) is not started.** Don't build toward it yet.

## Working style

Explain the concept and the reasoning before the code. When there's a real tradeoff, state it plainly rather than picking silently.
