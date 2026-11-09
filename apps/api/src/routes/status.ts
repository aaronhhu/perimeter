import { Router } from "express";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { blockAt, nextBlock, toClock } from "../schedule";
import { localClock, sessionAt } from "../session";
import { loadSessionInputs } from "../sessionInputs";

const clockBlock = (b: { weekday: number; startTime: string; endTime: string }) => ({
  weekday: b.weekday,
  startTime: toClock(b.startTime),
  endTime: toClock(b.endTime),
});

export const statusRouter = Router();

/**
 * Blocks come back as wall-clock times, manual sessions and breaks as instants: that's how each is
 * stored, and turning "next Monday 09:00" into an instant would mean doing DST arithmetic here for a
 * value the website only displays.
 */
statusRouter.get("/status", async (_req, res) => {
  const now = new Date();
  const inputs = await loadSessionInputs(db, CURRENT_USER_ID, now);
  const state = sessionAt(now, inputs);
  const clock = localClock(now, inputs.timezone);

  const block = blockAt(inputs.blocks, clock);
  const next = nextBlock(inputs.blocks, clock, state.paused);
  const manual = inputs.manualSessions[0];
  const pause = inputs.breaks[0];

  res.json({
    ...state,
    now,
    timezone: inputs.timezone,
    block: block && clockBlock(block),
    nextBlock: next && clockBlock(next),
    manualSession: manual ? { id: manual.id, startedAt: manual.startedAt, endsAt: manual.endsAt } : null,
    break: pause ? { id: pause.id, kind: pause.kind, startedAt: pause.startedAt, endsAt: pause.endsAt } : null,
  });
});
