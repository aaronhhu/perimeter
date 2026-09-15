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
- It's fast. Measured transition latency was a single sample, ~6 seconds.
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

### Signal conditioning

A single raw sample must never be allowed to change state. Stationary readings spike (a −79 was observed while sitting at the desk), and an early walking-around test produced desk and away readings that overlapped entirely. Three layers:

1. **Median smoothing** over the last N samples. Median rather than mean, so one wild reading is discarded rather than dragging the average.
2. **Hysteresis** — asymmetric thresholds. Present → Away below **−65**; Away → Present above **−55**. The dead zone sits inside the empty gap with ~3 dB margin on each side, so hovering near the boundary can't flip state repeatedly.
3. **Debounce** — require N consecutive smoothed readings past a threshold before committing to a transition.

**Thresholds are environment-specific.** The values above are calibrated to one room, one Mac, one phone. Different walls, distances, and hardware will shift them. For now they live in config; a calibration flow ("sit at your desk, now walk away") is a later problem but an inevitable one if this is ever used by anyone else.

### Where this logic lives

Signal conditioning lives in the **menu bar app**, not the API. This is a deliberate carve-out from the "all logic in the API" rule below, on the grounds that it isn't business logic — it's device physics and per-machine calibration, operating at a 5–15 second sample rate. Shipping every raw sample to the server to have it averaged there would be chatty and pointless.

The contract is therefore: **the menu bar app posts debounced presence transitions, not raw RSSI.** The API never sees a signal strength number except as optional debug telemetry on the event. Everything downstream of "the user left" or "the user came back" — active hours, break state, whether to notify, cooldowns — stays in the API.

### Open risk

All measurements so far were short runs with a recently-handled phone. In real use it sits locked and untouched for hours, and iOS throttles BLE advertising when idle. If `system_profiler` reports a cached last-known value rather than a fresh measurement, the app will believe the phone is at the desk forever — a silent failure. **A 30+ minute idle test is required before building on this.** If the value flatlines, a different read path (a native CoreBluetooth helper) is needed.

Separately, `system_profiler` takes 1–2 seconds per invocation and is a heavyweight way to read one number. Acceptable at a 15s poll interval; if the interval ever needs to tighten, a small Swift helper using CoreBluetooth is the replacement.

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
2. **menu-bar conditions the signal** — median smoothing, hysteresis, debounce — and derives a presence state.
3. **menu-bar → api** — `POST` event *only on a state transition*, not every poll.
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
