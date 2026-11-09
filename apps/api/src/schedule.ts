export interface ClockBlock {
  /** 0 = Sunday, matching schedule_blocks.weekday. */
  readonly weekday: number;
  /** "HH:MM", wall-clock in the user's timezone. */
  readonly startTime: string;
  /** "HH:MM"; "24:00" means end of day, since blocks can't cross midnight. */
  readonly endTime: string;
}

export const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const END_TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Index pairs of blocks on the same weekday that share any minute. Half-open, like `covers`, so
 * 09:00–12:00 and 12:00–13:00 touch without overlapping.
 */
export function findOverlaps(blocks: readonly ClockBlock[]): Array<[number, number]> {
  const overlaps: Array<[number, number]> = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (
        a.weekday === b.weekday &&
        minutesOf(a.startTime) < minutesOf(b.endTime) &&
        minutesOf(b.startTime) < minutesOf(a.endTime)
      ) {
        overlaps.push([i, j]);
      }
    }
  }
  return overlaps;
}

/** Postgres `time` arrives as "HH:MM:SS"; the API speaks minutes. */
export function toClock(time: string): string {
  return time.slice(0, 5);
}

/** Weekday, then start time — the order the website lists them in. */
export function byWeekdayThenStart(a: ClockBlock, b: ClockBlock): number {
  return a.weekday - b.weekday || minutesOf(a.startTime) - minutesOf(b.startTime);
}

const DAY_S = 86_400;

export interface WeekClock {
  /** 0 = Sunday. */
  readonly weekday: number;
  readonly secondOfDay: number;
}

/** The block covering this instant, if any. Blocks on one weekday never overlap, so there's at most one. */
export function blockAt<T extends ClockBlock>(blocks: readonly T[], clock: WeekClock): T | null {
  return (
    blocks.find(
      (b) =>
        b.weekday === clock.weekday &&
        minutesOf(b.startTime) * 60 <= clock.secondOfDay &&
        clock.secondOfDay < minutesOf(b.endTime) * 60,
    ) ?? null
  );
}

/**
 * The next block to start strictly after this instant, wrapping round the week. `skipToday` is for a
 * rest-of-day pause: it ends at midnight, so a block later today won't actually turn on.
 */
export function nextBlock<T extends ClockBlock>(
  blocks: readonly T[],
  clock: WeekClock,
  skipToday = false,
): T | null {
  const untilMidnight = DAY_S - clock.secondOfDay;
  let best: { block: T; offset: number } | null = null;
  for (const block of blocks) {
    let offset = ((block.weekday - clock.weekday + 7) % 7) * DAY_S + minutesOf(block.startTime) * 60 - clock.secondOfDay;
    if (offset <= 0) offset += 7 * DAY_S;
    if (skipToday && offset < untilMidnight) continue;
    if (best === null || offset < best.offset) best = { block, offset };
  }
  return best?.block ?? null;
}
