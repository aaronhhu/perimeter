import { eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { lockUser } from "../lock";
import { manualSessions } from "../schema";
import { sessionAt } from "../session";
import { loadSessionInputs } from "../sessionInputs";
import { endIdleShortBreaks } from "../shortBreaks";
import { badRequest } from "./validation";

const MINUTE_MS = 60_000;

const start = z.strictObject({ minutes: z.int().min(5).max(480) });

/** `code` is for the website to word the refusal; `error` is for people reading logs. */
type Refusal = { status: 404 | 409; code: string; error: string };

const refuse = (res: Response, r: Refusal): void => {
  res.status(r.status).json({ code: r.code, error: r.error });
};

export const sessionsRouter = Router();

sessionsRouter.post("/sessions", async (req, res) => {
  const parsed = start.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Invalid session", parsed.error);
    return;
  }

  const now = new Date();
  const result = await db.transaction(async (tx): Promise<Refusal | { id: number; startedAt: Date; endsAt: Date }> => {
    await lockUser(tx, CURRENT_USER_ID);
    const inputs = await loadSessionInputs(tx, CURRENT_USER_ID, now);
    const state = sessionAt(now, inputs);

    if (state.manual) {
      return { status: 409, code: "session_running", error: "A manual session is already running" };
    }
    // A manual session here would only duplicate the schedule. A short break inside a block still
    // counts as scheduled hours — the block is what the break is pausing.
    if (state.scheduled && !state.paused) {
      return { status: 409, code: "scheduled_hours", error: "Inside scheduled hours; pause the rest of the day first" };
    }

    await endIdleShortBreaks(tx, inputs, false, now);
    const [row] = await tx
      .insert(manualSessions)
      .values({ userId: CURRENT_USER_ID, startedAt: now, endsAt: new Date(now.getTime() + parsed.data.minutes * MINUTE_MS) })
      .returning({ id: manualSessions.id, startedAt: manualSessions.startedAt, endsAt: manualSessions.endsAt });
    if (row === undefined) throw new Error("INSERT ... RETURNING produced no row");
    return row;
  });

  if ("status" in result) {
    refuse(res, result);
    return;
  }
  res.status(201).json(result);
});

sessionsRouter.post("/sessions/current/end", async (_req, res) => {
  const now = new Date();
  const result = await db.transaction(async (tx): Promise<Refusal | { id: number; startedAt: Date; endsAt: Date; endedAt: Date | null }> => {
    await lockUser(tx, CURRENT_USER_ID);
    const inputs = await loadSessionInputs(tx, CURRENT_USER_ID, now);
    const running = inputs.manualSessions[0];
    if (running === undefined) {
      return { status: 404, code: "no_session", error: "No manual session is running" };
    }

    const [row] = await tx
      .update(manualSessions)
      .set({ endedAt: now })
      .where(eq(manualSessions.id, running.id))
      .returning({
        id: manualSessions.id,
        startedAt: manualSessions.startedAt,
        endsAt: manualSessions.endsAt,
        endedAt: manualSessions.endedAt,
      });
    if (row === undefined) throw new Error("UPDATE ... RETURNING produced no row");

    const state = sessionAt(now, inputs);
    // Still pausing the schedule if it's on, so kept; otherwise the session was all it paused.
    await endIdleShortBreaks(tx, inputs, state.scheduled && !state.paused, now);
    return row;
  });

  if ("status" in result) {
    refuse(res, result);
    return;
  }
  res.json(result);
});
