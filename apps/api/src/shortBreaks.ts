import { inArray } from "drizzle-orm";
import type { Tx } from "./contact";
import { breaks } from "./schema";
import type { LoadedInputs } from "./sessionInputs";

/**
 * Ends running short breaks unless `keep`, i.e. unless they still have something to pause. A short
 * break taken during a manual session outlives the session if that ends first; left alone it pauses
 * nothing, then pauses the next session started inside its 15 minutes, and blocks a new short break.
 */
export async function endIdleShortBreaks(tx: Tx, inputs: LoadedInputs, keep: boolean, now: Date): Promise<void> {
  if (keep) return;
  const ids = inputs.breaks.filter((b) => b.kind === "short").map((b) => b.id);
  if (ids.length > 0) await tx.update(breaks).set({ endedAt: now }).where(inArray(breaks.id, ids));
}
