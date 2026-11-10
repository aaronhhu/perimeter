import express from "express";
import { pool } from "./db";
import { heartbeatRouter } from "./routes/heartbeat";
import { meRouter } from "./routes/me";
import { presenceRouter } from "./routes/presence";
import { scheduleRouter } from "./routes/schedule";
import { sessionsRouter } from "./routes/sessions";
import { statusRouter } from "./routes/status";
import { timelineRouter } from "./routes/timeline";

// Separate from index.ts so tests can mount it on a random port without starting the real listener.
export const app = express();
app.use(express.json());
app.use(presenceRouter);
app.use(heartbeatRouter);
app.use(timelineRouter);
app.use(meRouter);
app.use(scheduleRouter);
app.use(statusRouter);
app.use(sessionsRouter);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch {
    res.status(503).json({ ok: false, db: "down" });
  }
});
