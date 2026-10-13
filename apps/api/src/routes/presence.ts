import { Router } from "express";
import { z } from "zod";
import { recordContact } from "../contact";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { presence, presenceCause, presenceEvents } from "../schema";
import { badRequest } from "./validation";

const presenceValue = z.enum(presence.enumValues);
const causeValue = z.enum(presenceCause.enumValues).exclude(["heartbeat_gap", "heartbeat_resume"]);
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
    badRequest(res, "Invalid presence event", parsed.error);
    return;
  }

  const event = parsed.data;
  const occurredAt = new Date(event.occurredAt);
  const id = await db.transaction(async (tx) => {
    await recordContact(tx, CURRENT_USER_ID, occurredAt);
    const [row] = await tx
      .insert(presenceEvents)
      .values({
        userId: CURRENT_USER_ID,
        presence: event.presence,
        cause: event.cause,
        smoothed: event.smoothed ?? null,
        occurredAt,
      })
      .returning({ id: presenceEvents.id });
    if (row === undefined) throw new Error("INSERT ... RETURNING produced no row");
    return row.id;
  });

  res.status(201).json({ id });
});
