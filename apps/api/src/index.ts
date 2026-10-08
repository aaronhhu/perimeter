import express from "express";
import { config } from "./config";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
