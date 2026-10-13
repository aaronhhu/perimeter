import { eq } from "drizzle-orm";
import { db } from "./db";
import { presenceEvents, users } from "./schema";

// Heartbeats come every 60s: one missed beat (a blip, a slow request) is forgiven, two is a gap.
export const GAP_MS = 150_000;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Notes that the Mac was heard from at `at` (its clock, like occurred_at). If the previous contact
 * was more than GAP_MS earlier, the silence is recorded as `unknown` from where it began — a Mac
 * asleep, an app not running and an API that was down all look the same from here, and none of them
 * can vouch for where the phone was. Returns whether a gap was recorded.
 *
 * Locks the user row so a heartbeat and an event arriving together can't both record the same gap.
 */
export async function recordContact(tx: Tx, userId: number, at: Date): Promise<boolean> {
  const [user] = await tx
    .select({ lastSeenAt: users.lastSeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (user === undefined) throw new Error(`No user with id ${userId}`);

  const last = user.lastSeenAt;
  const gap = last !== null && at.getTime() - last.getTime() > GAP_MS;
  if (gap) {
    await tx.insert(presenceEvents).values({ userId, presence: "unknown", cause: "heartbeat_gap", occurredAt: last });
  }
  // A late, out-of-order request must not move last_seen_at backwards and open a phantom gap.
  if (last === null || at > last) {
    await tx.update(users).set({ lastSeenAt: at }).where(eq(users.id, userId));
  }
  return gap;
}
