import { axis, describe, formatDuration, KIND_LABEL, segments, totals, type Kind, type Timeline } from "./timeline";

const KINDS: Kind[] = ["away", "present", "unknown", "offline"];

function clock(ms: number | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).toLowerCase();
}

function hourLabel(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" }).format(ms).toLowerCase().replace(" ", "");
}

function dateTime(ms: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function TimelineView({ timeline }: { timeline: Timeline }) {
  const tz = timeline.timezone;
  const segs = segments(timeline);
  const span = axis(segs, tz);
  const sum = totals(segs);
  const quietToday = timeline.quietSince !== null && timeline.quietSince >= timeline.start;

  if (span === null) {
    return (
      <p className="empty">
        Your Mac hasn't checked in today.
        {timeline.quietSince !== null && <> Last heard from {dateTime(timeline.quietSince, tz)}.</>}
      </p>
    );
  }

  const width = span.to - span.from;
  const pct = (ms: number) => `${((ms - span.from) / width) * 100}%`;
  // Roughly eight labels fit at phone width; every tick still draws a line.
  const labelEvery = Math.ceil(span.ticks.length / 8);

  return (
    <>
      <div className="bar-wrap">
        <div className="bar">
          {segs.map((s) => (
            <div
              key={s.from}
              className={`seg ${s.kind}`}
              style={{ left: pct(s.from), width: pct(span.from + (s.to - s.from)) }}
              title={`${KIND_LABEL[s.kind]} · ${clock(s.from, tz)} – ${clock(s.to, tz)} (${formatDuration(s.to - s.from)})`}
            />
          ))}
        </div>
        <div className="ticks">
          {span.ticks.map((t, i) => (
            <span key={t} className="tick" style={{ left: pct(t) }}>
              {i % labelEvery === 0 ? hourLabel(t, tz) : ""}
            </span>
          ))}
        </div>
      </div>

      <ul className="legend">
        {KINDS.map((k) => (
          <li key={k}>
            <span className={`swatch ${k}`} />
            {KIND_LABEL[k]}
            {sum[k] > 0 && <strong>{formatDuration(sum[k])}</strong>}
          </li>
        ))}
      </ul>

      <ol className="events">
        {quietToday && (
          <li className="ongoing">
            <time>{clock(timeline.quietSince!, tz)}</time>
            <div>
              <div>Mac has gone quiet</div>
              <div className="detail">Asleep, closed, or Perimeter isn't running. Nothing counts until it's back.</div>
            </div>
          </li>
        )}
        {[...timeline.events].reverse().map((e) => {
          const { title, detail } = describe(e);
          return (
            <li key={e.id}>
              <time>{clock(e.occurredAt, tz)}</time>
              <div>
                <div>{title}</div>
                {detail && <div className="detail">{detail}</div>}
              </div>
              {e.smoothed !== null && <span className="dbm">{Math.round(e.smoothed)} dBm</span>}
            </li>
          );
        })}
        {timeline.events.length === 0 && !quietToday && <li className="detail">No changes yet today.</li>}
      </ol>
    </>
  );
}
