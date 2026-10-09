import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "./config";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// An idle client whose connection dies (e.g. Postgres stops) emits this. Unhandled, it crashes the
// process — observed on `docker compose stop`. The pool drops that client and opens a fresh one later.
pool.on("error", (err) => {
  console.error("Idle Postgres client error:", err.message);
});

export const db = drizzle({ client: pool });
