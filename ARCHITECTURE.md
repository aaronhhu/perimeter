# Perimeter — Architecture

A Bluetooth-based focus/accountability app. The core mechanic: your iPhone's proximity to your Mac, sensed via BLE signal strength, drives whether a focus session is active — no companion iPhone app required.

## Components

| Component | Stack | Job |
|---|---|---|
| `apps/menu-bar` | Electron + TypeScript, `system_profiler` (shelled out) | Samples BLE signal strength, conditions it into a presence state, posts *transitions* to the API, fires local macOS notifications, can open the website |
| `apps/api` | Express + TypeScript, PostgreSQL (Drizzle ORM) | Source of truth for sessions/breaks/rules. Owns all *business* logic — the menu bar app owns only signal conditioning |
| `apps/website` | React + TypeScript | Settings (active hours, blocked sites), pause session, leaderboard |
| iPhone | — | No app. Its BLE advertisements, and how strongly the Mac hears them, *are* the signal. |

## The presence signal

This is the part that determines whether the product works at all, so it's documented in detail.

### What doesn't work

**Classic Bluetooth connection state.** The original plan was to poll `blueutil --is-connected`. This is a dead end, but not because the devices aren't paired — they are, and the iPhone shows up in `blueutil --paired`:

```
address: xx-xx-xx-xx-xx-xx, not connected, not favourite, paired, name: "<iPhone name>"
```

The actual problem is narrower: iOS refuses a classic Bluetooth connection to a Mac. Connecting from the iPhone's Bluetooth screen fails with "Connection Unsuccessful — '<Mac name>' is not supported" and a prompt to forget the device. So `blueutil --is-connected xx-xx-xx-xx-xx-xx` returns 0 permanently, at any distance, including with the phone touching the laptop. A value that never changes says nothing about proximity, so this approach was abandoned. (Do not act on that forget prompt — see *The pairing bond is load-bearing* below.)

**Raw BLE scanning.** Listening to all nearby advertisements without a bond would work for proximity but not identity — iOS rotates its BLE MAC address roughly every 15 minutes, and resolving it back to a specific device requires the identity resolving key from a bond. We don't have to do this ourselves because the existing pairing already gives the Mac that key (see below), but it's worth recording so it doesn't get reconsidered.

**Wi-Fi presence.** Zero hardware, but the range is the whole building. The mechanic needs desk-scale granularity; "phone is in the kitchen" must count as away, and Wi-Fi can't tell the kitchen from the desk.

### What does work

`system_profiler SPBluetoothDataType` reports an **RSSI** value for the iPhone. It reads that signal strength from the BLE advertisement packets the iPhone broadcasts continuously for Continuity, Handoff, AirDrop and Find My. That's one-way broadcast, not a connection — the Mac is only listening — which is why it works even though iOS refuses to connect.

The two checks operate at different layers. `--is-connected` asks about a negotiated link with a profile behind it, and the iPhone has no profile to offer a Mac, so that link never forms. Advertisements don't need a link at all.

This is strictly better than the connected/disconnected signal originally planned:

- It's continuous rather than binary, so *we* choose the distance threshold instead of accepting Apple's disconnect timeout.
- It's fast *at the source*. Raw readings track movement within a single sample, ~6 seconds. The shipped detection latency is deliberately slower (~40s) because conditioning trades responsiveness for not firing on noise — see *Signal conditioning*.
- Identity is solved by the pairing bond. The advertisements come from a rotating address, but the bond lets the Mac resolve it back to the paired iPhone, so each reading is attributed to the right device. This is why the pairing must stay — see below.

### The pairing bond is load-bearing

**Do not unpair the iPhone from the Mac.** Connection state is useless as a signal; the pairing is not. The two are easy to conflate, and acting on that conflation breaks the product.

iOS rotates its BLE MAC address roughly every 15 minutes. An RSSI reading is only meaningful if it can be attached to *this* phone, and the Mac can resolve a rotating address back to a specific device only because the pairing bond supplies the identity resolving key. Without the bond the advertisements keep arriving, but there's no stable identity to attach a reading to, and the whole presence mechanism breaks.

This is a real hazard, not a hypothetical one. When the connection attempt described above fails, iOS itself suggests forgetting the device, and this document says connection state is a dead end. It's a short step from there to "the pairing is pointless, clean it up." Don't — not from the iPhone's Bluetooth screen, and not from the Mac's Bluetooth settings. If presence ever stops working, check that the phone still appears in `blueutil --paired` first.

### Measured characteristics

Sampled at ~5s intervals in a single room:

| Position | RSSI range |
|---|---|
| At desk, phone beside laptop | −38 to −47 (tail to −52) |
| Same room, opposite corner | −68 to −79 |
| Adjacent space, out of room | −68 to −79 |

Two things fall out of this:

**There's a clean ~16 dB gap** between −52 and −68 with no samples in it. That gap is what makes thresholding viable.

**Medium and far are indistinguishable, and that's fine.** RSSI can't separate "next room" from "down the hall," but Perimeter doesn't care — both are away. The distinction it *can* make, in-room vs not-in-room, is exactly the granularity the mechanic needs.

### Reading the value

`system_profiler SPBluetoothDataType -json` gives structured output, so nothing here depends on scraping the human-readable text. The shape, trimmed to one device:

```json
{ "SPBluetoothDataType": [ {
    "controller_properties": { "controller_state": "attrib_on" },
    "device_not_connected": [
      { "aarons iphone": { "device_address": "5C:50:D9:CF:E6:F4", "device_rssi": "-42" } }
    ] } ] }
```

Three details that are easy to get wrong, all confirmed against live output:

- **`device_rssi` is a string**, not a number. It parses to a number, but it arrives quoted.
- **Each device is a single-key object keyed by its display name**, nested inside a per-bucket array. The iPhone appears under `device_not_connected` because iOS refuses a classic connection — but that's a fact about iOS, not a shape to depend on, so every `device_*` bucket is searched.
- **The device is matched on its address, not its name.** Names are user-editable; the bond identity address isn't. Addresses are compared by hex digits alone, so separator and case differences don't matter.

A paired device being *listed* is not the same as it being *sensed* — AirPods appear in the same bucket with no `device_rssi` at all. And Bluetooth being off is reported as `controller_state`, which also empties the device buckets, so the radio is checked first; otherwise the failure reports as the much less useful "device not found."

### Signal conditioning

A single raw sample must never be allowed to change state. Stationary readings spike (a −79 was observed while sitting at the desk), and an early walking-around test produced desk and away readings that overlapped entirely. Three layers:

1. **Median smoothing** over the last N samples. Median rather than mean, so one wild reading is discarded rather than dragging the average.
2. **Hysteresis** — asymmetric thresholds. Present → Away below **−65**; Away → Present above **−55**. The dead zone sits inside the empty gap with ~3 dB margin on each side, so hovering near the boundary can't flip state repeatedly.
3. **Debounce** — require N consecutive smoothed readings past a threshold before committing to a transition.

**Thresholds are environment-specific.** The values above are calibrated to one room, one Mac, one phone. Different walls, distances, and hardware will shift them. For now they live in config; a calibration flow ("sit at your desk, now walk away") is a later problem but an inevitable one if this is ever used by anyone else.

### When there's no number at all

Conditioning assumes a number arrived. Separately, a poll can produce none: Bluetooth switched off, the phone genuinely gone, `system_profiler` failing or timing out, or the device listed without an RSSI.

**A dropout is never fed to the filter as a substitute sample.** A missing measurement is not a weak one, and pushing a floor value (say −90) into the median would let one flaky invocation drag the smoothed value toward away — exactly the noise sensitivity the median exists to prevent. So:

1. **Short dropouts are skipped.** The window keeps the samples it already had, so a one-poll glitch costs nothing on recovery.
2. **A sustained dropout is away in its own right.** Three consecutive failures (~30s, kept under the ~40s signal-path latency so a blackout isn't a faster route to away) commit an `away` transition carrying *no* smoothed value — reporting an invented number here would disguise a sensor failure as a reading.
3. **That path also clears the window.** Samples from before a blackout shouldn't vote on the present once readings return, so recovery rebuilds from a full fresh window.

### Where this logic lives

Signal conditioning lives in the **menu bar app**, not the API. This is a deliberate carve-out from the "all logic in the API" rule below, on the grounds that it isn't business logic — it's device physics and per-machine calibration, operating at a 10-second sample rate. Shipping every raw sample to the server to have it averaged there would be chatty and pointless.

The contract is therefore: **the menu bar app posts debounced presence transitions, not raw RSSI.** The API never sees a signal strength number except as optional debug telemetry on the event. Everything downstream of "the user left" or "the user came back" — active hours, break state, whether to notify, cooldowns — stays in the API.

### Module layout

```
apps/menu-bar/src/
├── sampler.ts   # system_profiler → one reading, or the reason there isn't one
├── filter.ts    # RSSI numbers → debounced presence transitions
├── monitor.ts   # poll cadence + dropout policy → presence events
└── index.ts     # wiring: config, logging, and where the POST to the API will go
```

Each layer keeps a pure core apart from its impure edge: `parseRssi` is pure and only `readRssi` runs a process; `advance` holds the whole dropout policy and only `startMonitor` touches the clock. That's what lets the policy be tested without hardware and without waiting in real time, the same way the filter is tested against the recorded RSSI log.

One cadence detail that matters: **the next poll is scheduled after the previous one completes**, not on a `setInterval`. The window size and debounce are tuned against evenly spaced samples, and a fixed interval can overlap invocations if one runs slow — which silently changes the spacing the tuning assumes.

### Risks, and what testing settled

**Staleness — tested, passed.** The worry was that iOS throttles BLE advertising when a phone sits locked and untouched, and that `system_profiler` might then report a cached last-known value forever — the app would believe the phone is at the desk permanently, a silent failure. The 35-minute idle run (138 samples, phone untouched) settled it: values kept updating throughout, no flatline and no drift. A native CoreBluetooth read path is therefore not needed, and stays on the shelf.

**Invocation cost — measured, and ~20× cheaper than first recorded.** This document previously put `system_profiler` at 1–2 seconds per invocation. Measured on the development Mac across several runs, it is **50–75ms**, so it is not the heavyweight call it was assumed to be, and cost is no longer a reason to avoid tightening the poll interval. The constraint that remains is tuning, not cost: the window and debounce are validated against 10s spacing, so changing the interval means re-validating both.

**Still open: behaviour beyond 35 minutes.** Real use is hours, not half an hour. Nothing observed so far suggests a problem, but multi-hour idle behaviour is simply unmeasured. The dropout handling above is partly insurance against that — a read path that quietly stops producing values now reads as away instead of as a phone that never leaves.

## Repo structure

Single monorepo, pnpm workspaces (no Turborepo/Nx needed at this size). Note that pnpm ignores the `workspaces` field in `package.json` and reads `pnpm-workspace.yaml` instead:

```
perimeter/
├── apps/
│   ├── menu-bar/
│   ├── api/
│   └── website/
└── packages/
    └── shared-types/   # create when the first type would otherwise be copy-pasted
```

**Why one repo:** `menu-bar` and `api` have to agree on the exact event/response payload shape. In separate repos that contract only lives in your head. Shared types turn a mismatch into a compile error instead of a runtime surprise.

`shared-types` shouldn't be scaffolded before there's a real shared type to put in it. When it is created, decide its consumption model up front: no build step with `"types": "./src/index.ts"` works for Vite and the Electron bundler, but a plain `tsc` build of the API will reject importing TS from outside its `rootDir`. Either run the API through `tsx`/`tsup`, or give `shared-types` a real build step.

## Core data flow (Phase 1)

1. **iPhone → menu-bar app** — BLE advertisements, RSSI sampled locally via `system_profiler`.
2. **menu-bar conditions the signal** — median smoothing, hysteresis, debounce — and derives a presence state. A poll that yields no reading is skipped rather than smoothed, and a sustained run of them reads as away.
3. **menu-bar → api** — `POST` event *only on a state transition*, not every poll. (Not wired yet: `apps/api` doesn't exist, so transitions are currently logged at the seam where the POST will go.)
4. **api evaluates rules** — is it within active hours? is the user on a break? has a notification fired too recently? — and returns a decision (e.g. `{ notify: true }`) in the same response.
5. **menu-bar → user** — if told to, fires a native macOS notification.
6. **api ↔ website** — config reads/writes, leaderboard data.
7. **menu-bar → website** — a "Settings" item opens the site (`shell.openExternal`), ideally with a short-lived token in the URL so the user doesn't have to log in again.

Edge detection now happens as part of debouncing in step 2, so the API receives transitions by construction rather than having to detect them. Notification cooldown stays in the API, where it belongs — it's a rule, not physics.

## Key decisions and why

- **Business logic lives in the API, not the Electron app.** Active-hours and break-state checks can change (user edits schedule, starts a break) and need one source of truth. The menu bar app is a sensor + renderer. The one exception is signal conditioning, for the reasons given above.
- **Pause is website-only, on purpose.** The friction is the feature — an easy pause defeats the point. A menu-bar shortcut to `POST /sessions/:id/pause` could be added later without any backend change; deliberately not doing it yet.
- **Docker is for local Postgres only** (`docker-compose`), not for the menu bar app or website. Production Postgres should be a managed service (Neon/Supabase/Render), not self-hosted.
- **Hosting:** API on Render/Railway/Fly.io, website on Vercel, menu bar app packaged with `electron-builder` into a `.dmg` and distributed directly — no App Store, no notarization needed for Phase 1.

## Fallbacks if RSSI fails

Kept on record in case the idle test kills the current approach:

- **BLE beacon on a keychain.** A cheap beacon broadcasts a static address at desk range, solving identity and proximity at once. The cost is philosophical — you're detecting your keys, not your phone. Probably acceptable for a self-accountability tool.
- **Companion iOS app.** Restores the phone as the true signal and kills the cleanest property of the design. Expensive in non-obvious ways: iOS background BLE is heavily restricted, a paid developer account is required, and distribution means TestFlight or review. A multi-weekend detour.

## Phase 2 (not started)

- **Website blocking** when phone is out of range (e.g. block TikTok while away from desk). Likely via `/etc/hosts` rewriting rather than a browser extension — simpler, no per-browser code, but needs elevated permissions and must **restore the hosts file on every app launch** so a crash never leaves a domain permanently blocked.
- **Elevated permissions:** leaning toward a scoped `sudoers.d` `NOPASSWD` exception (one-time admin prompt during setup) over Apple's `SMJobBless` privileged-helper pattern. Much less setup cost; the trade-off is a standing door left open rather than Apple's scoped/audited helper — judged acceptable for a personal accountability tool, not something being distributed to strangers.
- **Known limitation, accepted:** hosts-file blocking is trivially reversible by anyone who edits the file back, or by just using a phone browser. This is a self-accountability tool, not a parental control — not worth serious anti-circumvention effort right now.
