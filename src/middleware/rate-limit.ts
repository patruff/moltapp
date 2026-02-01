import { rateLimiter } from "hono-rate-limiter";
import type { Context } from "hono";
import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "../config/constants.ts";

type RateLimitEnv = {
  Variables: {
    agentId: string;
  };
};

/**
 * Per-agent rate limiter.
 *
 * Must be applied AFTER auth middleware so that agentId is available
 * in the request context for the key generator.
 *
 * 60 requests per minute per agent (or by IP for unauthenticated requests).
 */
export const agentRateLimiter = rateLimiter<RateLimitEnv>({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  keyGenerator: (c: Context<RateLimitEnv>) => {
    return c.get("agentId") || c.req.header("x-forwarded-for") || "anonymous";
  },
});
