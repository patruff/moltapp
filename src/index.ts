import { serve } from "@hono/node-server";
import { env } from "./config/env.ts";
import app from "./app.ts";
import {
  installSignalHandlers,
  registerShutdownHook,
} from "./services/lifecycle.ts";

// Install signal handlers for graceful shutdown (SIGTERM, SIGINT)
installSignalHandlers();

// Register shutdown hooks (run in order during graceful shutdown)
registerShutdownHook("log-shutdown", async () => {
  console.log("[Shutdown] MoltApp server shutting down...");
});

// Start local development server
const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`MoltApp API listening on port ${info.port}`);
  },
);

// Register server close as a shutdown hook
registerShutdownHook("close-http-server", async () => {
  return new Promise<void>((resolve) => {
    server.close(() => {
      console.log("[Shutdown] HTTP server closed");
      resolve();
    });
  });
});
