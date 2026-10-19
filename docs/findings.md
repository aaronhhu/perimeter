# Perimeter — Findings

Measurements and test results behind the rules in `CLAUDE.md` and the design in `ARCHITECTURE.md`.
Newest first. Each entry says what was run, what it showed, and what it changed. When a later run
corrects an earlier one, both stay, and the earlier one says so.

All readings are from one room, one Mac, one iPhone.

---

## 2026-10-17 — Walk-back test: first reading after a silence

**Question:** can the Mac tell a phone carried back from out of range apart from one that sat on the
desk with Bluetooth off? Crediting an honest `cold_start` depends on it.

**Run:** CLI with `PERIMETER_DEBUG=1`. Two returns from out of range at a normal walk, and one
Bluetooth off/on with the phone on the desk.

| Trial | First readings after the silence | Then |
|---|---|---|
| Carried back from out of range | −79, −74 | −40 at the desk |
| Carried back from out of range | −72, −60 | −40 at the desk |
| Bluetooth off and on at the desk | −50 | −41 |

**Showed:**

- A real return gives about 10s (two polls) of weak readings before the strong ones. The desk
  toggle comes back strong on its first reading, about 20 dB apart from the weak returns.
- The existing thresholds split them: the walk-back readings are below `awayBelow` (−65) and the
  desk one is above `presentAbove` (−55).
- The first reading after a gap is fresh. The desk trial echoed −39 for about 35s before the
  dropout, then came back at −50, not −39.

**Not settled:** three trials. Repeat each a few times, including a brisk walk, before relying on it.

**Also seen:** launched with the phone at −85. Five readings filled the window, then it went silent
one poll short of committing `away`. Because `seen` was true, it was reported as `dropout` and drew
the "is Bluetooth off?" nudge, though the phone really was far away.

**Logging note:** `| tee` alone drops the "no reading" lines, because they go to stderr. Use
`2>&1 | tee`.

---

## 2026-09-29 — Cold start vs. a phone that vanished early

Keying `cold_start` off `emitted === null` left a ~30s hole at launch. Observed: five readings at
−36 dBm, then silence one poll short of the first commit. The phone was plainly on the desk and its
Bluetooth was switched off, but it was reported as a cold start and got the gentle message. Led to
`MonitorState.seen`.

---

## 2026-09-29 — 5s poll interval trial (4 minutes)

**Question:** does `system_profiler` actually refresh at 5s, or does the median end up voting on one
physical reading three times?

**Showed:**

- It refreshes. Values changed on 63% of polls, with runs of 1–3. That's nothing like the 3×
  duplication feared.
- Signal-path latency halved as intended. Cold start and post-blackout recovery both confirmed
  `present` in 26s, against 52s at 10s.
- Faster polling doesn't speed up the dropout path. Freeze-to-nudge took 56s at 5s against ~60s at
  10s, because the echo is wall-clock and only `dropoutSamples` scales.
- **The Bluetooth-off echo is wall-clock, not a poll count:** ~30–45s, seen as 9 identical repeats.
  This corrects the earlier "~3 polls", which was an artifact of only measuring at 10s.
  `dropoutSamples` was raised 3 → 6 to keep the counter worth ~30s. Total cost of a dropout: ~45s
  of stale repeats, then `dropoutSamples`, so ~75s.

**Not settled (both want a 30+ minute run before 5s is final):**

- **A spike landing inside a hold.** Replaying the real −69 desk spike: held for 1 or 2 polls, the
  filter absorbs it; held for 3, it commits a false `away`. This run had 3-runs but no spike (the
  35-minute log had two), so the failure needs both at once. That makes it a probability, not an
  impossibility.
- **Effective window shrinkage.** 21 distinct values across 33 polls is ~3.2 independent samples
  per 5-wide window, down from ~4.6 at 15s spacing.
- **A consequence for the window:** a 30–45s echo is 9 samples at 5s, enough to fill the whole
  5-wide window, so the filter can commit a transition on what is physically one measurement. At
  10s an echo was 3 samples and couldn't outvote the window. That's harmless when the frozen value
  sits deep in present territory, as observed, but not harmless if a freeze ever captures a value
  near a threshold.

---

## By 2026-09-28 — Bluetooth off: staleness and what `system_profiler` reports

**Run:** iPhone Bluetooth switched off, tested on both Wi-Fi and hotspot.

**Showed:**

- `system_profiler` keeps serving the last known RSSI for a while, then drops the `device_rssi`
  field entirely, which the sampler reports as `rssi-absent`. A frozen value doesn't persist, so the
  planned "identical value for N polls" heuristic was dropped as unnecessary.
- `rssi-absent` is the end state for both "Bluetooth off at the desk" and "phone out of range".
  Both were observed directly. This ambiguity is the reason for the dropout rule.
- The device list comes from pairing records, not from what's reachable. Everything ever paired
  stays listed. The AirPods are listed with no `device_rssi` at all, and a far-away phone is still
  listed. So `device-absent` can only mean a wrong address or a broken pairing, never distance.
- The whole device entry is six fields: `device_address`, `device_firmwareVersion`,
  `device_minorType`, `device_productID`, `device_rssi`, `device_vendorID`. There's no timestamp or
  last-seen field to infer anything from.

---

## By 2026-09-28 — 35-minute idle run (138 samples)

**Run:** phone untouched on the desk, Bluetooth on, ~15s spacing.

**Showed:**

- Values keep updating, with no staleness and no drift. The longest run of identical consecutive
  values was 3 (116 singles, 8 pairs, 2 triples).
- Two spikes, including a **−69 with the phone untouched on the desk**. That's past the away
  threshold, and it's why a single raw sample must never change state.
- The tuned parameters (median of 5, debounce 2, away below −65, present above −55) produced zero
  false transitions when replayed against this log.

**Not settled:** behaviour beyond 35 minutes. Real use is hours.

---

## Early sampling — RSSI ranges and invocation cost

Sampled at ~5s intervals in one room:

| Position | RSSI |
|---|---|
| At desk, phone beside laptop | −38 to −47 (tail to −52) |
| Same room, opposite corner | −68 to −79 |
| Out of the room | −68 to −79 |

- There's a clean ~16 dB gap between −52 and −68, which is what makes thresholding viable.
- A −79 was also seen with the phone at the desk, and an early walking-around test produced desk
  and away readings that overlapped entirely. These were the first evidence for smoothing.
- `system_profiler` takes **50–75ms** per call on the development Mac, not the 1–2s first recorded.
  Cost isn't a reason to avoid a faster poll; re-validating the tuning is.

---

## Early — Approaches tested and rejected

- **`blueutil --is-connected`:** the iPhone is paired, but iOS refuses a classic connection to a Mac
  ("'<Mac name>' is not supported"). It returns 0 at any distance, even touching the laptop.
- **Raw BLE scanning:** iOS rotates its BLE address roughly every 15 minutes. Resolving it needs the
  identity resolving key from a bond, which the existing pairing already provides.
- **Wi-Fi presence:** the range is the whole building, so it can't tell the kitchen from the desk.

Full write-up in `ARCHITECTURE.md`, *What doesn't work*.
