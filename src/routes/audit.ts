/**
 * Audit Log API Routes
 *
 * Public API for querying the audit trail. Provides filtered access to
 * trading events, circuit breaker activations, system events, and more.
 *
 * All audit data is read-only through this API. Write operations
 * (logging events) happen automatically through the audit-log service.
 */

import { Hono } from "hono";
import {
  queryAuditLog,
  getAuditEvent,
  getAuditLogStats,
  type AuditCategory,
  type AuditSeverity,
} from "../services/audit-log.ts";

const auditRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /api/v1/audit — Query audit events
// ---------------------------------------------------------------------------

auditRoutes.get("/", (c) => {
  const category = c.req.query("category") as AuditCategory | undefined;
  const severity = c.req.query("severity") as AuditSeverity | undefined;
  const agentId = c.req.query("agentId") ?? undefined;
  const roundId = c.req.query("roundId") ?? undefined;
  const action = c.req.query("action") ?? undefined;
  const source = c.req.query("source") ?? undefined;
  const startTime = c.req.query("startTime") ?? undefined;
  const endTime = c.req.query("endTime") ?? undefined;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const result = queryAuditLog({
    category,
    severity,
    agentId,
    roundId,
    action,
    source,
    startTime,
    endTime,
    limit: Math.min(limit, 200),
    offset,
  });

  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/v1/audit/stats — Audit log statistics
// ---------------------------------------------------------------------------

auditRoutes.get("/stats", (c) => {
  const stats = getAuditLogStats();
  return c.json(stats);
});

// ---------------------------------------------------------------------------
// GET /api/v1/audit/:eventId — Get a single event
// ---------------------------------------------------------------------------

auditRoutes.get("/:eventId", (c) => {
  const eventId = c.req.param("eventId");
  const event = getAuditEvent(eventId);

  if (!event) {
    return c.json({ error: "not_found", message: "Audit event not found" }, 404);
  }

  return c.json(event);
});

export { auditRoutes };
