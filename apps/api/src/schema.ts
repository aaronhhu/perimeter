import { doublePrecision, index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const presence = pgEnum("presence", ["present", "away", "unknown"]);
export const presenceCause = pgEnum("presence_cause", ["signal", "dropout", "cold_start", "bluetooth_off"]);

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
