import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Server } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * A real Postgres (PGlite, in-process) reached through the same `pg` driver the API uses, with the
 * real migrations applied, so type round-trips (`time`, `timestamptz`) and transactions are tested
 * as they run in production. No Docker needed.
 *
 * Limit: PGlite is a single session behind the socket. Sequential requests are faithful; concurrent
 * ones would share one transaction, so row locking (`recordContact`'s FOR UPDATE) can't be tested here.
 */
export interface Harness {
  readonly request: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  readonly sql: (text: string, params?: unknown[]) => Promise<any[]>;
  readonly reset: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export async function startHarness(): Promise<Harness> {
  const pglite = new PGlite();
  const dbPort = await freePort();
  const socket = new PGLiteSocketServer({ db: pglite, port: dbPort, maxConnections: 10 });
  await socket.start();

  // config.ts reads this at import, so it has to be set before anything below loads the app.
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${dbPort}/postgres`;

  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await setup.connect();
  await migrate(drizzle({ client: setup }), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await setup.query(`INSERT INTO users (name, timezone) VALUES ('Test', 'America/Los_Angeles')`);
  await setup.end();

  const { app } = await import("../app");
  const { pool } = await import("../db");
  const http: Server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  const sql = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

  return {
    request: async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    sql,
    reset: async () => {
      await sql(`DELETE FROM presence_events; DELETE FROM schedule_blocks; DELETE FROM manual_sessions; DELETE FROM breaks;`);
      await sql(`UPDATE users SET timezone = 'America/Los_Angeles', notify_interval_s = 600, last_seen_at = NULL`);
    },
    stop: async () => {
      await new Promise((resolve) => http.close(resolve));
      await pool.end();
      await socket.stop();
      await pglite.close();
    },
  };
}
