import type { breaks, manualSessions, scheduleBlocks } from "./schema";

export type ScheduleBlock = Pick<typeof scheduleBlocks.$inferSelect, "weekday" | "startTime" | "endTime">;
export type ManualSession = Pick<typeof manualSessions.$inferSelect, "startedAt" | "endsAt" | "endedAt">;
export type Break = Pick<typeof breaks.$inferSelect, "kind" | "startedAt" | "endsAt" | "endedAt">;

export interface SessionInputs {
  /** IANA name, from the user row. */
  readonly timezone: string;
  readonly blocks: readonly ScheduleBlock[];
  readonly manualSessions: readonly ManualSession[];
  readonly breaks: readonly Break[];
}

/** The parts as well as the verdict: a manual session inside scheduled hours is two true answers, and the website words each differently. */
export interface SessionState {
  readonly on: boolean;
  readonly scheduled: boolean;
  readonly paused: boolean;
  readonly manual: boolean;
  readonly shortBreak: boolean;
}

/** The rule decided 2026-11-02 — see ARCHITECTURE.md, *When a session is active*. */
export function sessionAt(at: Date, inputs: SessionInputs): SessionState {
  const clock = localClock(at, inputs.timezone);
  const scheduled = inputs.blocks.some((block) => blockCovers(block, clock));
  const manual = inputs.manualSessions.some((session) => covers(session, at));
  const shortBreak = inputs.breaks.some((b) => b.kind === "short" && covers(b, at));
  const paused = inputs.breaks.some((b) => b.kind === "rest_of_day" && covers(b, at));

  return { on: !shortBreak && ((scheduled && !paused) || manual), scheduled, paused, manual, shortBreak };
}

/** Half-open, so back-to-back ranges never both claim the instant where one hands over to the next. */
export function covers(range: { startedAt: Date; endsAt: Date; endedAt: Date | null }, at: Date): boolean {
  // An ended_at after ends_at would mean "ended early" extended it; the earlier of the two wins.
  const end = range.endedAt !== null && range.endedAt < range.endsAt ? range.endedAt : range.endsAt;
  return range.startedAt <= at && at < end;
}

export interface LocalClock {
  /** 0 = Sunday, matching schedule_blocks.weekday. */
  readonly weekday: number;
  readonly secondOfDay: number;
}

export function blockCovers(block: ScheduleBlock, clock: LocalClock): boolean {
  return (
    block.weekday === clock.weekday &&
    secondsOf(block.startTime) <= clock.secondOfDay &&
    clock.secondOfDay < secondsOf(block.endTime)
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

export function localClock(at: Date, timezone: string): LocalClock {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }

  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const weekday = WEEKDAYS.indexOf(parts["weekday"] ?? "");
  if (weekday === -1) throw new Error(`Unexpected weekday from Intl: ${parts["weekday"]}`);

  return {
    weekday,
    secondOfDay: Number(parts["hour"]) * 3600 + Number(parts["minute"]) * 60 + Number(parts["second"]),
  };
}

/** Postgres `time` arrives as "HH:MM:SS"; "24:00:00" is valid and means end of day. */
function secondsOf(time: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}
