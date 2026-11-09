import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { users } from "../schema";
import { isTimeZone } from "../timezone";
import { badRequest } from "./validation";

const columns = { name: users.name, timezone: users.timezone, notifyIntervalS: users.notifyIntervalS };

const patch = z
  .strictObject({
    timezone: z.string().refine(isTimeZone, "Not an IANA time zone"),
    // Below the 60s heartbeat it couldn't fire any faster; above an hour a nudge stops being a nudge.
    notifyIntervalS: z.int().min(60).max(3600),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

export const meRouter = Router();

meRouter.get("/me", async (_req, res) => {
  const [user] = await db.select(columns).from(users).where(eq(users.id, CURRENT_USER_ID));
  if (user === undefined) throw new Error(`No user with id ${CURRENT_USER_ID}`);
  res.json(user);
});

meRouter.patch("/me", async (req, res) => {
  const parsed = patch.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Invalid settings", parsed.error);
    return;
  }

  const [user] = await db.update(users).set(parsed.data).where(eq(users.id, CURRENT_USER_ID)).returning(columns);
  if (user === undefined) throw new Error(`No user with id ${CURRENT_USER_ID}`);
  res.json(user);
});
