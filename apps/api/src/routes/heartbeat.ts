import { Router } from "express";
import { z } from "zod";
import { recordContact } from "../contact";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { presence, presenceEvents } from "../schema";
import { badRequest } from "./validation";

const heartbeat = z.strictObject({
  // Null for the ~30s after launch before the app's first verdict.
  presence: z.enum(presence.enumValues).nullable(),
  sentAt: z.iso.datetime({ offset: true }),
});

export const heartbeatRouter = Router();

heartbeatRouter.post("/heartbeat", async (req, res) => {
  const parsed = heartbeat.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Invalid heartbeat", parsed.error);
    return;
  }

  const { presence: current } = parsed.data;
  const sentAt = new Date(parsed.data.sentAt);
  await db.transaction(async (tx) => {
    const gap = await recordContact(tx, CURRENT_USER_ID, sentAt);
    // The app only sends what changes, and a Mac waking with the phone where it left it changes
    // nothing — without this the timeline would read unknown until the phone next moved.
    if (gap && (current === "present" || current === "away")) {
      await tx
        .insert(presenceEvents)
        .values({ userId: CURRENT_USER_ID, presence: current, cause: "heartbeat_resume", occurredAt: sentAt });
    }
  });

  // Not a stub: with no schedule or session tables yet, no session is ever active, so there's never
  // anything to nudge about.
  res.json({ notify: false });
});
