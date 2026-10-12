import type { PresenceEvent } from "./monitor";

export type SendResult = { readonly ok: true; readonly id: number } | { readonly ok: false; readonly reason: string };

// Long enough for a slow API, short enough that a hung one can't leave requests piling up across transitions.
const TIMEOUT_MS = 5_000;

/**
 * Never rejects: the caller logs a failure and drops the event. The 60s heartbeat will restate the
 * current state, so a lost transition costs its exact time, not the state itself.
 */
export async function sendPresenceEvent(
  apiUrl: string,
  event: PresenceEvent,
  occurredAt: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await fetchImpl(new URL("/presence-events", apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, occurredAt: occurredAt.toISOString() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}: ${await response.text()}` };
    }
    const { id } = (await response.json()) as { id: number };
    return { ok: true, id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
