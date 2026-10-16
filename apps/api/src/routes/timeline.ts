import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { GAP_MS } from "../contact";
import { CURRENT_USER_ID } from "../currentUser";
import { db } from "../db";
import { presenceEvents, users } from "../schema";
import { badRequest } from "./validation";

const query = z.strictObject({ date: z.iso.date().optional() });

const columns = {
  id: presenceEvents.id,
  presence: presenceEvents.presence,
  cause: presenceEvents.cause,
  smoothed: presenceEvents.smoothed,
  occurredAt: presenceEvents.occurredAt,
};

export const timelineRouter = Router();

timelineRouter.get("/timeline", async (req, res) => {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "Invalid timeline query", parsed.error);
    return;
  }

  const [user] = await db
    .select({ timezone: users.timezone, lastSeenAt: users.lastSeenAt })
    .from(users)
    .where(eq(users.id, CURRENT_USER_ID));
  if (user === undefined) throw new Error(`No user with id ${CURRENT_USER_ID}`);

  // Postgres resolves the user's midnight, DST included. Epoch millis rather than timestamptz because
  // drizzle's node-postgres driver hands raw execute() results back as unparsed strings.
  const {
    rows: [bounds],
  } = await db.execute<{ date: string; start: string; end: string }>(sql`
    SELECT d::text AS date,
           (extract(epoch FROM d::timestamp AT TIME ZONE ${user.timezone}) * 1000)::bigint::text AS start,
           (extract(epoch FROM (d + 1)::timestamp AT TIME ZONE ${user.timezone}) * 1000)::bigint::text AS "end"
    FROM (SELECT coalesce(${parsed.data.date ?? null}::date, (now() AT TIME ZONE ${user.timezone})::date) AS d) AS day
  `);
  if (bounds === undefined) throw new Error("Day bounds query produced no row");
  const start = new Date(Number(bounds.start));
  const end = new Date(Number(bounds.end));

  const mine = eq(presenceEvents.userId, CURRENT_USER_ID);
  // The state at midnight is whatever the last event before it said.
  const [before] = await db
    .select(columns)
    .from(presenceEvents)
    .where(and(mine, lt(presenceEvents.occurredAt, start)))
    .orderBy(desc(presenceEvents.occurredAt), desc(presenceEvents.id))
    .limit(1);
  const events = await db
    .select(columns)
    .from(presenceEvents)
    .where(and(mine, gte(presenceEvents.occurredAt, start), lt(presenceEvents.occurredAt, end)))
    .orderBy(asc(presenceEvents.occurredAt), asc(presenceEvents.id));

  // A gap is only written when the Mac next makes contact, so a Mac that's quiet right now has no
  // row for it yet.
  const now = new Date();
  const quiet = user.lastSeenAt !== null && now.getTime() - user.lastSeenAt.getTime() > GAP_MS;

  res.json({
    date: bounds.date,
    timezone: user.timezone,
    start,
    end,
    now,
    before: before ?? null,
    events,
    quietSince: quiet ? user.lastSeenAt : null,
  });
});
