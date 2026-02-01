import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { env } from "./config/env.ts";

const app = new Hono();

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Start server
serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`MoltApp API listening on port ${info.port}`);
  }
);

export default app;
