import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
} from "drizzle-orm/pg-core";

export const presence = pgEnum("presence", ["present", "away", "unknown"]);
export const presenceCause = pgEnum("presence_cause", [
  "signal",
  "dropout",
  "cold_start",
  "bluetooth_off",
  // Recorded by the API itself, never sent by the app.
  "heartbeat_gap",
  "heartbeat_resume",
]);

export const breakKind = pgEnum("break_kind", ["short", "rest_of_day"]);

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  // IANA name, e.g. "Europe/London" — applied to the schedule and to "midnight"; timestamps stay UTC.
  timezone: text().notNull(),
  notifyIntervalS: integer("notify_interval_s").notNull().default(600),
  // Null until the first heartbeat.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

// Append-only: one row per transition, never updated or deleted.
export const presenceEvents = pgTable(
  "presence_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    presence: presence().notNull(),
    cause: presenceCause().notNull(),
    smoothed: doublePrecision(),
    // The Mac's clock, not ours — received_at is the server's view of the same event.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("presence_events_user_id_occurred_at_idx").on(t.userId, t.occurredAt)],
);

// Wall-clock times in the user's timezone, not instants: 09:00 stays 09:00 across DST.
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // 0 = Sunday, matching Postgres's extract(dow) and JS's getDay().
    weekday: smallint().notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    index("schedule_blocks_user_id_weekday_idx").on(t.userId, t.weekday),
    check("schedule_blocks_weekday_check", sql`${t.weekday} BETWEEN 0 AND 6`),
    // Blocks can't cross midnight. Overlaps are rejected on save, not here.
    check("schedule_blocks_order_check", sql`${t.endTime} > ${t.startTime}`),
  ],
);

export const manualSessions = pgTable(
  "manual_sessions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Set only when ended early; a session that ran its length keeps it null.
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("manual_sessions_user_id_started_at_idx").on(t.userId, t.startedAt),
    check("manual_sessions_order_check", sql`${t.endsAt} > ${t.startedAt}`),
    check("manual_sessions_ended_check", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const breaks = pgTable(
  "breaks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    kind: breakKind().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Set only when ended early.
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("breaks_user_id_started_at_idx").on(t.userId, t.startedAt),
    check("breaks_order_check", sql`${t.endsAt} > ${t.startedAt}`),
    check("breaks_ended_check", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  ],
);
