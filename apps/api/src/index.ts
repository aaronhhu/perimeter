import express from "express";
import { config } from "./config";
import { pool } from "./db";
import { heartbeatRouter } from "./routes/heartbeat";
import { meRouter } from "./routes/me";
import { presenceRouter } from "./routes/presence";
import { scheduleRouter } from "./routes/schedule";
import { statusRouter } from "./routes/status";
import { timelineRouter } from "./routes/timeline";

const app = express();
app.use(express.json());
app.use(presenceRouter);
app.use(heartbeatRouter);
app.use(timelineRouter);
app.use(meRouter);
app.use(scheduleRouter);
app.use(statusRouter);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch {
    res.status(503).json({ ok: false, db: "down" });
  }
});

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
