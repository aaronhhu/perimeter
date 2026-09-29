# Perimeter — Architecture

A Bluetooth-based focus/accountability app. The core mechanic: your iPhone's proximity to your Mac, sensed via BLE signal strength, drives whether a focus session is active — no companion iPhone app required.

## Components

| Component | Stack | Job |
|---|---|---|
| `apps/menu-bar` | Electron + TypeScript, `system_profiler` (shelled out) | Samples BLE signal strength, conditions it into a presence state, posts *transitions* to the API, fires local macOS notifications, can open the website |
| `apps/api` | Express + TypeScript, PostgreSQL (Drizzle ORM) | Source of truth for sessions/breaks/rules. Owns all *business* logic — the menu bar app owns only signal conditioning |
| `apps/website` | React + TypeScript | Settings (schedule, blocked sites), start a manual session, take a break, leaderboard |
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
- It's fast *at the source*. Raw readings track movement within a single sample, ~6 seconds. The shipped detection latency is deliberately slower (~4 polls, so 20s at the current 5s interval) because conditioning trades responsiveness for not firing on noise — see *Signal conditioning*.
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

A phone with Bluetooth off and a phone out of range both end up in that last case, and neither arrives promptly: macOS repeats the last known RSSI for about three polls before it drops the field, so those readings look valid on the way down and the dropout counter starts ~30s late.

**A dropout is never fed to the filter as a substitute sample.** A missing measurement is not a weak one, and pushing a floor value (say −90) into the median would let one flaky invocation drag the smoothed value toward away — exactly the noise sensitivity the median exists to prevent. So:

1. **Short dropouts are skipped.** The window keeps the samples it already had, so a one-poll glitch costs nothing on recovery.
2. **A sustained dropout keeps the last verified state.** Three consecutive failures (~30s) count as a dropout. If the last verified state was `away`, nothing is emitted: the phone left and then went quiet, which is what a phone far away looks like. If it was `present`, emit `unknown` (no smoothed value) and nudge "Can't see your phone — is Bluetooth off?". Why: without an iPhone app, a phone with Bluetooth off and a phone out of range are indistinguishable from the Mac. Treating every dropout as `away` let one tap (Bluetooth off at the desk) earn focus credit; treating every dropout as `unknown` denied credit to users who put the phone genuinely far away. The remaining cheat — walk the phone far, turn Bluetooth off, bring it back — is deliberate and multi-step, which is the bar this project accepts (see Phase 2 hosts-file blocking). Two cases fall outside the rule and go straight to `unknown`: a cold start that has never verified anything, and this Mac's own radio being off, which says nothing about distance and so can't leave an `away` standing.
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

**Staleness — settled, and no detection needed.** The worry was that `system_profiler` might report a cached last-known value forever. The 35-minute idle run (138 samples, phone untouched, Bluetooth on) showed values updating throughout: the longest run of identical consecutive values was 3 (116 singles, 8 pairs, 2 triples). Turning the iPhone's Bluetooth off does freeze the value, but not indefinitely — tested on both Wi-Fi and hotspot, macOS repeats the last RSSI and then drops `device_rssi` entirely, which the sampler already reports as `rssi-absent`. The planned heuristic (identical value for N consecutive polls → dropout, backdated to the freeze) was therefore dropped: the existing dropout path covers it.

That echo was originally recorded as "about three polls". A later run at a 5s interval showed **nine** identical repeats, which corrects the finding rather than contradicting it: the echo is a wall-clock duration of roughly 30–45s, and the original figure was an artifact of measuring it only at 10s. Two consequences. The failure counter now starts ~45s in, not ~30s. And polling faster barely improves the dropout path at all — freeze-to-nudge measured 56s at 5s against ~60s at 10s, because the echo is fixed and only `dropoutSamples` scales with the interval. `dropoutSamples` was raised 3 → 6 to keep that counter worth ~30s of wall clock, so a single slow `system_profiler` still cannot fire a user-facing nudge.

What the test did surface is a different problem. `rssi-absent` is the end state for *both* Bluetooth-off and genuinely-out-of-range, so the sampler cannot tell a session being gamed from one being honoured. That ambiguity is resolved a layer up rather than in the sampler — see *When there's no number at all*, where it is the entire reason for the last-verified-state rule.

**Invocation cost — measured, and ~20× cheaper than first recorded.** This document previously put `system_profiler` at 1–2 seconds per invocation. Measured on the development Mac across several runs, it is **50–75ms**, so it is not the heavyweight call it was assumed to be, and cost is no longer a reason to avoid tightening the poll interval. The constraint that remains is tuning, not cost: the window and debounce were validated against 15s spacing, so changing the interval means re-validating both. The interval is currently 5s on trial — see *Signal conditioning* in CLAUDE.md for what that run settled and what it left open.

**Still open: behaviour beyond 35 minutes.** Real use is hours, not half an hour. Nothing observed so far suggests a problem, but multi-hour idle behaviour is simply unmeasured.

**Still open: fast departures.** Away detection takes ~4 polls by design, so 20s at the current 5s interval. A phone carried out of range faster than that loses signal while the state is still `present`, which the dropout rule reads as `unknown`. Likely fix: look at the last few raw readings before the loss and treat a weak tail as a departure — how many is a number to tune from logs, not guess.

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
3. **menu-bar → api** — a `POST` on every state transition, sent immediately, **plus a heartbeat of the current state every 60s**. Never raw RSSI. (Not wired yet: `apps/api` doesn't exist, so transitions are currently logged at the seam where the POST will go.)
4. **api evaluates rules** — is a session active (schedule, manual session, break)? is the phone present? has the nudge interval passed? — and returns a decision (e.g. `{ notify: true }`) in the same response.
5. **menu-bar → user** — if told to, fires a native macOS notification.
6. **api ↔ website** — config reads/writes, leaderboard data.
7. **menu-bar → website** — a "Settings" item opens the site (`shell.openExternal`), ideally with a short-lived token in the URL so the user doesn't have to log in again.

Edge detection happens as part of debouncing in step 2, so the API receives transitions by construction rather than having to detect them. The heartbeat exists because some nudges happen when *nothing changes* — the phone was already on the desk when the session started, or it just stays there. Notification timing stays in the API, where it belongs — it's a rule, not physics.

## Key decisions and why

- **Business logic lives in the API, not the Electron app.** Active-hours and break-state checks can change (user edits schedule, starts a break) and need one source of truth. The menu bar app is a sensor + renderer. The one exception is signal conditioning, for the reasons given above.
- **Breaks are website-only, on purpose.** The friction is the feature — an easy pause defeats the point. A menu-bar shortcut to `POST /breaks` could be added later without any backend change; deliberately not doing it yet.
- **Docker is for local Postgres only** (`docker-compose`), not for the menu bar app or website. Production Postgres should be a managed service (Neon/Supabase/Render), not self-hosted.
- **Hosting:** API on Render/Railway/Fly.io, website on Vercel, menu bar app packaged with `electron-builder` into a `.dmg` and distributed directly — no App Store, no notarization needed for Phase 1.

## Sessions, focus and notifications

Decided 2026-09-18; not built yet.

### What the signal means

`present`/`away` describe the **phone**, not the user. **Focus = the phone is verifiably away during an active session.** Planned refinement: also require recent keyboard/mouse activity (`HIDIdleTime` via `ioreg`), so time spent away from the Mac doesn't count as focus. That arrives as a second kind of event in the same log, with no schema change to what's below.

### When a session is active

- **Schedule.** Users set their own hours as blocks per weekday. The backend supports several blocks per day from the start; the MVP website edits one per day, so adding more later is frontend-only. Blocks can't cross midnight, and overlapping blocks are rejected on save (they would double-count scheduled time).
- **Manual sessions.** Can be started from the website at any time, including outside the schedule, for a chosen length. `ends_at = started_at + length`, and it may run past midnight. Ending never requires an action, so forgetting a session is harmless.
- **Breaks** (website only). Either 15 minutes, or the rest of the day (ends at local midnight). A rest-of-day break also ends any running manual session. Starting a session during a break ends the break (`ended_at`).
- **The rule:** the latest user action wins; the schedule is the default when nothing overrides it.

Everything is stored as **time ranges, not a status flag**. Nothing has to run at 9:00 or at the end of a break to flip state, so there are no cron jobs, and whether a session is active at any instant is a pure function of the rows. The same rows answer "how much focus today" for the leaderboard. Timestamps are stored in UTC; the user's timezone lives on the user row and is applied for the schedule and "midnight".

There is **no stored `sessions` table** for scheduled sessions: focus time is computed from events, schedule, manual sessions and breaks. Add a daily rollup if the leaderboard ever gets slow.

### Dropouts and unknown time

- A dropout keeps the last verified state — see *When there's no number at all* above.
- Mac Bluetooth off → `unknown`, plus a local nudge to turn it back on.
- A heartbeat gap longer than ~2 minutes (Mac asleep, app not running) is recorded as `unknown` starting at the previous `last_seen_at`.
- **Unknown time never counts as focus.**

### Notifications

- **Nudge whenever the phone is present during an active session** — whether it just arrived, or was already there when the session started or a break ended. Repeat every `notify_interval` while it stays (default 10 minutes, per user).
- **Mechanism: a 60-second heartbeat.** The menu bar sends its current state every minute (as well as transitions immediately), and the API replies `{ notify }`. Heartbeats are not stored as events; they update `last_seen_at`, and gaps become `unknown` as above.
- **Alternatives considered:**
  - A `nextCheckAt` hint in each response: fewer requests, but it misses website changes (a break started on the site) until the next check, and gives no liveness signal.
  - Server push (WebSocket/SSE): instant, but needs timers running on the server — the cron jobs the range model avoids — plus reconnect logic. Revisit if a website action ever has to reach the menu bar within seconds; the heartbeat stays as the fallback.
  - Rules in the menu bar app: breaks the "API owns business logic" rule and creates two copies of the rules.

  The heartbeat wins on failure mode: a missed request is corrected a minute later. Up to 60s of extra latency doesn't matter next to ~20s detection and a 10-minute nudge interval.

### Tables (first pass)

```
users            id, name, timezone, notify_interval_s, last_seen_at
schedule_blocks  id, user_id, weekday, start_time, end_time          -- several per day allowed
presence_events  id, user_id, presence ('present'|'away'|'unknown'),
                 cause, smoothed (nullable), occurred_at, received_at  -- append-only, transitions only
manual_sessions  id, user_id, started_at, ends_at, ended_at (nullable)
breaks           id, user_id, kind ('short'|'rest_of_day'), started_at, ends_at, ended_at (nullable)
notifications    id, user_id, event_id (nullable), sent_at            -- audit trail + interval check
```

- `occurred_at` is when the Mac saw it; `received_at` is when the API got it. Rules and totals use `occurred_at`.
- `notifications.event_id` is nullable because heartbeat-triggered nudges have no triggering event.
- `cause` records why an event happened (signal, dropout, heartbeat gap), so dropout policy can change later without a migration. The exact set of values gets settled when the schema is written.

### Minimal first cut

1. `docker-compose` with Postgres only.
2. `apps/api`: Express + Drizzle, one migration, one seeded user. No auth.
3. The transition + heartbeat endpoint, returning `{ notify }`.
4. Replace the `TODO` in the menu bar's `onEvent` with the request, and print the decision.

Done when: phone on the desk during an active schedule block prints `notify: true`, and the same state a minute later prints `notify: false` until the interval passes.

## Fallbacks if RSSI fails

Kept on record in case the idle test kills the current approach:

- **BLE beacon on a keychain.** A cheap beacon broadcasts a static address at desk range, solving identity and proximity at once. The cost is philosophical — you're detecting your keys, not your phone. Probably acceptable for a self-accountability tool.
- **Companion iOS app.** Restores the phone as the true signal and kills the cleanest property of the design. Expensive in non-obvious ways: iOS background BLE is heavily restricted, a paid developer account is required, and distribution means TestFlight or review. A multi-weekend detour.

## Phase 2 (not started)

- **Website blocking** when phone is out of range (e.g. block TikTok while away from desk). Likely via `/etc/hosts` rewriting rather than a browser extension — simpler, no per-browser code, but needs elevated permissions and must **restore the hosts file on every app launch** so a crash never leaves a domain permanently blocked.
- **Elevated permissions:** leaning toward a scoped `sudoers.d` `NOPASSWD` exception (one-time admin prompt during setup) over Apple's `SMJobBless` privileged-helper pattern. Much less setup cost; the trade-off is a standing door left open rather than Apple's scoped/audited helper — judged acceptable for a personal accountability tool, not something being distributed to strangers.
- **Known limitation, accepted:** hosts-file blocking is trivially reversible by anyone who edits the file back, or by just using a phone browser. This is a self-accountability tool, not a parental control — not worth serious anti-circumvention effort right now.
