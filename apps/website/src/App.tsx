import { useCallback, useEffect, useState } from "react";
import type { Timeline } from "./timeline";
import { TimelineView } from "./TimelineView";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; timeline: Timeline };

function heading(date: string): string {
  // Noon UTC so the calendar date can't slip a day whatever the browser's zone.
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/timeline");
      if (!res.ok) throw new Error(`The API answered ${res.status}.`);
      setLoad({ state: "ready", timeline: (await res.json()) as Timeline });
    } catch (err) {
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main>
      <header>
        <h1>
          Today{load.state === "ready" && <span className="date"> — {heading(load.timeline.date)}</span>}
        </h1>
        <button onClick={() => void refresh()}>Refresh</button>
      </header>
      {load.state === "loading" && <p className="empty">Loading…</p>}
      {load.state === "error" && (
        <p className="empty">
          Can't reach the API. Is it running? <code>pnpm --filter @perimeter/api dev</code>
          <br />
          <span className="detail">{load.message}</span>
        </p>
      )}
      {load.state === "ready" && <TimelineView timeline={load.timeline} />}
      <p className="footnote">
        Phone away isn't the same as focus yet. That needs sessions, which don't exist yet.
      </p>
    </main>
  );
}
