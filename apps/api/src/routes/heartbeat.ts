import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { presence, users } from "../schema";
import { badRequest } from "./validation";

const heartbeat = z.strictObject({
  // Null for the ~30s after launch before the app's first verdict. Nothing reads it yet; it's in the
  // contract now so the notify rules can use it without the app changing.
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

  // The Mac's clock, like occurred_at, so gaps and events are measured on the same clock.
  const [row] = await db
    .update(users)
    .set({ lastSeenAt: new Date(parsed.data.sentAt) })
    .where(eq(users.id, CURRENT_USER_ID))
    .returning({ id: users.id });
  if (row === undefined) throw new Error(`No user with id ${CURRENT_USER_ID}`);

  // Not a stub: with no schedule or session tables yet, no session is ever active, so there's never
  // anything to nudge about.
  res.json({ notify: false });
});
