import { db, pool } from "./db";
import { users } from "./schema";

// Single-user until auth exists, so "already seeded" means "any user at all". Makes reruns harmless.
const existing = await db.select().from(users).limit(1);

if (existing.length > 0) {
  console.log("Users table not empty, skipping seed");
} else {
  const [user] = await db
    .insert(users)
    .values({ name: "Aaron", timezone: "America/Los_Angeles" })
    .returning();
  console.log("Seeded user:", user);
}

await pool.end();
