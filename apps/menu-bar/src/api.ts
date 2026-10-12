import type { PresenceEvent, ReportedPresence } from "./monitor";

type Result<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string };
export type SendResult = Result<{ readonly id: number }>;
export type HeartbeatResult = Result<{ readonly notify: boolean }>;

// Long enough for a slow API, short enough that a hung one can't leave requests piling up across transitions.
const TIMEOUT_MS = 5_000;

export const HEARTBEAT_INTERVAL_MS = 60_000;

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
  const result = await post(apiUrl, "/presence-events", { ...event, occurredAt: occurredAt.toISOString() }, fetchImpl);
  return result.ok ? { ok: true, id: (result.body as { id: number }).id } : result;
}

/** `presence` is null until the first verdict, ~30s after launch. */
export async function sendHeartbeat(
  apiUrl: string,
  presence: ReportedPresence | null,
  sentAt: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<HeartbeatResult> {
  const result = await post(apiUrl, "/heartbeat", { presence, sentAt: sentAt.toISOString() }, fetchImpl);
  return result.ok ? { ok: true, notify: (result.body as { notify: boolean }).notify } : result;
}

/** Beats once immediately, so the API hears about a launch without waiting a minute. Returns a stop function. */
export function startHeartbeat(
  apiUrl: string,
  current: () => ReportedPresence | null,
  onFailure: (reason: string) => void,
): () => void {
  const beat = (): void => {
    void sendHeartbeat(apiUrl, current(), new Date()).then((result) => {
      if (!result.ok) onFailure(result.reason);
    });
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function post(
  apiUrl: string,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<Result<{ readonly body: unknown }>> {
  try {
    const response = await fetchImpl(new URL(path, apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}: ${await response.text()}` };
    }
    return { ok: true, body: await response.json() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
