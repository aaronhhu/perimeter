import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { END_TIME, START_TIME, byWeekdayThenStart, findOverlaps, minutesOf, toClock } from "../schedule";
import { scheduleBlocks } from "../schema";
import { badRequest } from "./validation";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const block = z
  .strictObject({
    weekday: z.int().min(0).max(6),
    startTime: z.string().regex(START_TIME, 'Expected "HH:MM"'),
    endTime: z.string().regex(END_TIME, 'Expected "HH:MM", or "24:00" for end of day'),
  })
  // The DB check would catch this too, but as a 500 with no hint which block it was.
  .refine((b) => minutesOf(b.endTime) > minutesOf(b.startTime), {
    message: "Must end after it starts (blocks can't cross midnight)",
    path: ["endTime"],
  });

const week = z
  .strictObject({ blocks: z.array(block).max(50) })
  .superRefine(({ blocks }, ctx) => {
    for (const [i, j] of findOverlaps(blocks)) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      ctx.addIssue({
        code: "custom",
        path: ["blocks", j],
        message: `${WEEKDAY_NAMES[b.weekday]} ${b.startTime}–${b.endTime} overlaps ${a.startTime}–${a.endTime}`,
      });
    }
  });

async function readWeek() {
  const rows = await db
    .select({ weekday: scheduleBlocks.weekday, startTime: scheduleBlocks.startTime, endTime: scheduleBlocks.endTime })
    .from(scheduleBlocks)
    .where(eq(scheduleBlocks.userId, CURRENT_USER_ID));
  return rows
    .map((row) => ({ weekday: row.weekday, startTime: toClock(row.startTime), endTime: toClock(row.endTime) }))
    .sort(byWeekdayThenStart);
}

export const scheduleRouter = Router();

scheduleRouter.get("/schedule", async (_req, res) => {
  res.json({ blocks: await readWeek() });
});

/** Replaces the whole week: the website edits it as one form, so per-block routes would only add ways to half-save it. */
scheduleRouter.put("/schedule", async (req, res) => {
  const parsed = week.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Invalid schedule", parsed.error);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(scheduleBlocks).where(eq(scheduleBlocks.userId, CURRENT_USER_ID));
    if (parsed.data.blocks.length > 0) {
      await tx.insert(scheduleBlocks).values(parsed.data.blocks.map((b) => ({ ...b, userId: CURRENT_USER_ID })));
    }
  });

  res.json({ blocks: await readWeek() });
});
