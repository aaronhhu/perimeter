import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  // IANA name, e.g. "Europe/London" — applied to the schedule and to "midnight"; timestamps stay UTC.
  timezone: text().notNull(),
  notifyIntervalS: integer("notify_interval_s").notNull().default(600),
  // Null until the first heartbeat.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});
