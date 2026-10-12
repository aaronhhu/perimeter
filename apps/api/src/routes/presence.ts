import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { presence, presenceCause, presenceEvents } from "../schema";

// Replaced by the authenticated user once auth exists.
export const CURRENT_USER_ID = 1;

const presenceValue = z.enum(presence.enumValues);
const causeValue = z.enum(presenceCause.enumValues);
const occurredAt = z.iso.datetime({ offset: true });

const presenceEvent = z.discriminatedUnion("cause", [
  z.strictObject({
    cause: causeValue.extract(["signal"]),
    presence: presenceValue.exclude(["unknown"]),
    smoothed: z.number(),
    occurredAt,
  }),
  // A blackout has no reading; inventing one would misreport a sensor failure as a measurement.
  z.strictObject({
    cause: causeValue.exclude(["signal"]),
    presence: presenceValue.extract(["unknown"]),
    smoothed: z.null().optional(),
    occurredAt,
  }),
]);

export const presenceRouter = Router();

presenceRouter.post("/presence-events", async (req, res) => {
  const parsed = presenceEvent.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid presence event",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  const event = parsed.data;
  const [row] = await db
    .insert(presenceEvents)
    .values({
      userId: CURRENT_USER_ID,
      presence: event.presence,
      cause: event.cause,
      smoothed: event.smoothed ?? null,
      occurredAt: new Date(event.occurredAt),
    })
    .returning({ id: presenceEvents.id });
  if (row === undefined) throw new Error("INSERT ... RETURNING produced no row");

  res.status(201).json({ id: row.id });
});
