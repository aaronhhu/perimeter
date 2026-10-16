export type Presence = "present" | "away" | "unknown";
export type Cause = "signal" | "dropout" | "cold_start" | "bluetooth_off" | "heartbeat_gap" | "heartbeat_resume";

export interface PresenceEvent {
  readonly id: number;
  readonly presence: Presence;
  readonly cause: Cause;
  readonly smoothed: number | null;
  readonly occurredAt: string;
}

/** `GET /timeline` — one day in the user's timezone. */
export interface Timeline {
  readonly date: string;
  readonly timezone: string;
  readonly start: string;
  readonly end: string;
  readonly now: string;
  readonly before: PresenceEvent | null;
  readonly events: readonly PresenceEvent[];
  readonly quietSince: string | null;
}

/**
 * `offline` is split out of `unknown` even though the database stores both as `unknown`: "the Mac
 * wasn't watching" and "the Mac was watching but couldn't see the phone" are different stories.
 */
export type Kind = "away" | "present" | "unknown" | "offline";

export interface Segment {
  kind: Kind;
  from: number;
  to: number;
}

export function kindOf(event: PresenceEvent): Kind {
  return event.cause === "heartbeat_gap" ? "offline" : event.presence;
}

const HOUR = 3_600_000;

/**
 * Each event holds until the next one, since only changes are stored. The last runs up to now, or
 * to where the Mac went quiet if it has — that silence has no row until the Mac next checks in.
 *
 * Offline time before the first sign of life is dropped: a Mac asleep overnight would otherwise
 * stretch every morning's bar back to midnight.
 */
export function segments(timeline: Timeline): Segment[] {
  const start = Date.parse(timeline.start);
  const stop = Math.min(Date.parse(timeline.end), Date.parse(timeline.now));
  const out: Segment[] = [];
  const push = (kind: Kind | null, from: number, to: number) => {
    from = Math.max(from, start);
    to = Math.min(to, stop);
    if (kind === null || to <= from) return;
    const last = out.at(-1);
    if (last !== undefined && last.kind === kind && last.to === from) last.to = to;
    else out.push({ kind, from, to });
  };

  let kind = timeline.before === null ? null : kindOf(timeline.before);
  let cursor = start;
  for (const event of timeline.events) {
    const at = Date.parse(event.occurredAt);
    push(kind, cursor, at);
    cursor = Math.max(cursor, at);
    kind = kindOf(event);
  }
  const quiet = timeline.quietSince === null ? Infinity : Date.parse(timeline.quietSince);
  push(kind, cursor, quiet);
  push("offline", Math.max(cursor, quiet), stop);

  while (out[0]?.kind === "offline") out.shift();
  return out;
}

export function totals(segs: readonly Segment[]): Record<Kind, number> {
  const sum: Record<Kind, number> = { away: 0, present: 0, unknown: 0, offline: 0 };
  for (const s of segs) sum[s.kind] += s.to - s.from;
  return sum;
}

function minuteInZone(ms: number, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, minute: "numeric" }).format(ms));
}

/** Start of the zone's hour containing `ms` — not UTC's, which is off by 30 minutes in e.g. India. */
export function floorHour(ms: number, timeZone: string): number {
  const minute = ms - (ms % 60_000);
  return minute - minuteInZone(minute, timeZone) * 60_000;
}

/** Whole hours spanning the segments, for the axis. */
export function axis(segs: readonly Segment[], timeZone: string): { from: number; to: number; ticks: number[] } | null {
  const first = segs[0];
  const last = segs.at(-1);
  if (first === undefined || last === undefined) return null;
  const from = floorHour(first.from, timeZone);
  const to = floorHour(last.to - 1, timeZone) + HOUR;
  const ticks: number[] = [];
  for (let t = from; t <= to; t += HOUR) ticks.push(t);
  return { from, to, ticks };
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export const KIND_LABEL: Record<Kind, string> = {
  away: "Phone away",
  present: "Phone at desk",
  unknown: "Couldn't tell",
  offline: "Mac offline",
};

/** Wording matches the menu bar's tray titles and nudges, so the same moment reads the same in both. */
export function describe(event: PresenceEvent): { title: string; detail: string | null } {
  switch (event.cause) {
    case "signal":
      return { title: event.presence === "present" ? "Phone is at your desk" : "Phone is away", detail: null };
    case "dropout":
      return {
        title: "Lost your phone's signal while it was at your desk",
        detail: "Is its Bluetooth off? This time doesn't count as focus.",
      };
    case "cold_start":
      return { title: "Haven't seen your phone yet", detail: "Nothing counts as focus until it turns up." };
    case "bluetooth_off":
      return { title: "Bluetooth is off on this Mac", detail: "Perimeter can't see your phone without it." };
    case "heartbeat_gap":
      return { title: "Mac went quiet", detail: "Asleep, closed, or Perimeter wasn't running." };
    case "heartbeat_resume":
      return {
        title: `Mac back online — phone ${event.presence === "present" ? "at your desk" : "away"}`,
        detail: "Where the phone was when the Mac went quiet; corrected within ~30s if it moved.",
      };
  }
}
