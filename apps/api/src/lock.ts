import { eq } from "drizzle-orm";
import type { Tx } from "./contact";
import { users } from "./schema";

/**
 * Serializes every session and break change for one user. Without it, two quick clicks could both
 * read "nothing running" and both insert a session — the checks only hold if they can't interleave.
 */
export async function lockUser(tx: Tx, userId: number): Promise<void> {
  const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  if (row === undefined) throw new Error(`No user with id ${userId}`);
}
