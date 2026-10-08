import express from "express";
import { config } from "./config";
import { pool } from "./db";

const app = express();
app.use(express.json());

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
