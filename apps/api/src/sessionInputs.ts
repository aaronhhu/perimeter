import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Tx } from "./contact";
import type { db } from "./db";
import { breaks, manualSessions, scheduleBlocks, users } from "./schema";
import type { Break, ManualSession, ScheduleBlock } from "./session";

/** `SessionInputs`, plus the row ids the routes need to end a session or break. */
export interface LoadedInputs {
  readonly timezone: string;
  readonly blocks: readonly ScheduleBlock[];
  readonly manualSessions: ReadonlyArray<ManualSession & { readonly id: number }>;
  readonly breaks: ReadonlyArray<Break & { readonly id: number }>;
}

/**
 * Everything `sessionAt` needs to judge `at`. Only rows that cover `at` are loaded: a range that has
 * ended can't change the verdict, so there's no reason to read the user's whole history.
 */
export async function loadSessionInputs(
  conn: Tx | typeof db,
  userId: number,
  at: Date,
): Promise<LoadedInputs> {
  const [user] = await conn.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  if (user === undefined) throw new Error(`No user with id ${userId}`);

  const blocks = await conn
    .select({ weekday: scheduleBlocks.weekday, startTime: scheduleBlocks.startTime, endTime: scheduleBlocks.endTime })
    .from(scheduleBlocks)
    .where(eq(scheduleBlocks.userId, userId));

  const running = <T extends typeof manualSessions | typeof breaks>(t: T) =>
    and(eq(t.userId, userId), lte(t.startedAt, at), gt(t.endsAt, at), or(isNull(t.endedAt), gt(t.endedAt, at)));

  const manual = await conn
    .select({
      id: manualSessions.id,
      startedAt: manualSessions.startedAt,
      endsAt: manualSessions.endsAt,
      endedAt: manualSessions.endedAt,
    })
    .from(manualSessions)
    .where(running(manualSessions));
  const breakRows = await conn
    .select({ id: breaks.id, kind: breaks.kind, startedAt: breaks.startedAt, endsAt: breaks.endsAt, endedAt: breaks.endedAt })
    .from(breaks)
    .where(running(breaks));

  return { timezone: user.timezone, blocks, manualSessions: manual, breaks: breakRows };
}
