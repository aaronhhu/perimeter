import { eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Tx } from "../contact";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { lockUser } from "../lock";
import { breakKind, breaks, manualSessions } from "../schema";
import { sessionAt } from "../session";
import { loadSessionInputs } from "../sessionInputs";
import { endIdleShortBreaks } from "../shortBreaks";
import { badRequest } from "./validation";

const SHORT_MS = 15 * 60_000;

const start = z.strictObject({ kind: z.enum(breakKind.enumValues) });

type Refusal = { status: 404 | 409; code: string; error: string };
type BreakRow = { id: number; kind: "short" | "rest_of_day"; startedAt: Date; endsAt: Date; endedAt: Date | null };

const returning = {
  id: breaks.id,
  kind: breaks.kind,
  startedAt: breaks.startedAt,
  endsAt: breaks.endsAt,
  endedAt: breaks.endedAt,
};

/** Postgres resolves the user's next midnight, DST included, the same way /timeline finds day bounds. */
async function nextLocalMidnight(tx: Tx, timezone: string, now: Date): Promise<Date> {
  const {
    rows: [row],
  } = await tx.execute<{ ms: string }>(sql`
    SELECT (extract(epoch FROM ((${now.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date + 1)::timestamp
             AT TIME ZONE ${timezone}) * 1000)::bigint::text AS ms
  `);
  if (row === undefined) throw new Error("Midnight query produced no row");
  return new Date(Number(row.ms));
}

export const breaksRouter = Router();

breaksRouter.post("/breaks", async (req, res) => {
  const parsed = start.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Invalid break", parsed.error);
    return;
  }
  const { kind } = parsed.data;

  const now = new Date();
  const result = await db.transaction(async (tx): Promise<Refusal | BreakRow> => {
    await lockUser(tx, CURRENT_USER_ID);
    const inputs = await loadSessionInputs(tx, CURRENT_USER_ID, now);
    const state = sessionAt(now, inputs);
    const scheduleOn = state.scheduled && !state.paused;

    // Settle a short break that's pausing nothing first, or it would block a new one for no reason.
    await endIdleShortBreaks(tx, inputs, scheduleOn || state.manual, now);
    const shortRunning = state.shortBreak && (scheduleOn || state.manual);

    if (kind === "short") {
      if (shortRunning) return { status: 409, code: "break_running", error: "A short break is already running" };
      // A pause inside a paused day is fine as long as a manual session is what it pauses.
      if (!scheduleOn && !state.manual) {
        return { status: 409, code: "nothing_to_pause", error: "No session is on to take a break from" };
      }
    } else {
      if (state.paused) return { status: 409, code: "break_running", error: "The rest of the day is already paused" };
      // Ends the day's manual session too (decided 2026-09-18), and with it any short break inside it.
      const sessionIds = inputs.manualSessions.map((m) => m.id);
      if (sessionIds.length > 0) {
        await tx.update(manualSessions).set({ endedAt: now }).where(inArray(manualSessions.id, sessionIds));
      }
      await endIdleShortBreaks(tx, inputs, false, now);
    }

    const endsAt =
      kind === "short" ? new Date(now.getTime() + SHORT_MS) : await nextLocalMidnight(tx, inputs.timezone, now);
    const [row] = await tx
      .insert(breaks)
      .values({ userId: CURRENT_USER_ID, kind, startedAt: now, endsAt })
      .returning(returning);
    if (row === undefined) throw new Error("INSERT ... RETURNING produced no row");
    return row;
  });

  if ("status" in result) {
    res.status(result.status).json({ code: result.code, error: result.error });
    return;
  }
  res.status(201).json(result);
});

/**
 * Ends the most recent break. Two can run at once — a short break during a manual session on a paused
 * day — and the short one is always the newer, so ending twice steps back out: session, then schedule.
 */
breaksRouter.post("/breaks/current/end", async (_req, res) => {
  const now = new Date();
  const result = await db.transaction(async (tx): Promise<Refusal | BreakRow> => {
    await lockUser(tx, CURRENT_USER_ID);
    const inputs = await loadSessionInputs(tx, CURRENT_USER_ID, now);
    const latest = [...inputs.breaks].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id - a.id)[0];
    if (latest === undefined) return { status: 404, code: "no_break", error: "No break is running" };

    const [row] = await tx.update(breaks).set({ endedAt: now }).where(eq(breaks.id, latest.id)).returning(returning);
    if (row === undefined) throw new Error("UPDATE ... RETURNING produced no row");
    return row;
  });

  if ("status" in result) {
    res.status(result.status).json({ code: result.code, error: result.error });
    return;
  }
  res.json(result);
});
