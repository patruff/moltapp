import { serve } from "@hono/node-server";
import { env } from "./config/env.ts";
import app from "./app.ts";

// Start local development server
serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`MoltApp API listening on port ${info.port}`);
  }
);
