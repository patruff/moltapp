/**
 * Singleton Trading Lock
 *
 * Prevents concurrent trading rounds from executing simultaneously.
 * Uses an in-memory lock with optional DynamoDB backing for distributed
 * Lambda environments.
 *
 * Features:
 * - Mutual exclusion: only one trading round runs at a time
 * - TTL-based auto-release: lock expires after 25 minutes
 * - Graceful skip: if a 30-min cycle is still running, next one skips
 * - Prevents double-buying positions
 * - Lock status reporting for monitoring
 *
 * DynamoDB Schema (when deployed):
 *   PK: "TRADING_LOCK"
 *   lockId: unique ID per lock acquisition
 *   acquiredAt: ISO timestamp
 *   expiresAt: ISO timestamp (TTL)
 *   holderInfo: descriptive string (round ID)
 */

import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockInfo {
  lockId: string;
  acquiredAt: string;
  expiresAt: string;
  holderInfo: string;
  isExpired: boolean;
}

export interface LockAcquisitionResult {
  acquired: boolean;
  lockId: string | null;
  /** If not acquired, info about who holds the lock */
  existingLock: LockInfo | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Lock TTL in milliseconds (25 minutes) */
const LOCK_TTL_MS = 25 * 60 * 1000;

/** DynamoDB table name for distributed locking */
const DYNAMO_TABLE = process.env.AGENT_STATE_TABLE || "moltapp-agent-state";

/** Lock partition key in DynamoDB */
const LOCK_PK = "TRADING_LOCK";

// ---------------------------------------------------------------------------
// In-Memory Lock State
// ---------------------------------------------------------------------------

let currentLock: {
  lockId: string;
  acquiredAt: number;
  expiresAt: number;
  holderInfo: string;
} | null = null;

function generateLockId(): string {
  return `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isLockExpired(): boolean {
  if (!currentLock) return true;
  return Date.now() > currentLock.expiresAt;
}

// ---------------------------------------------------------------------------
// Core Lock Operations
// ---------------------------------------------------------------------------

/**
 * Attempt to acquire the trading lock.
 *
 * Returns `{ acquired: true, lockId }` if successful.
 * Returns `{ acquired: false, existingLock }` if another round is running.
 *
 * The lock auto-expires after 25 minutes to prevent deadlocks.
 */
export async function acquireLock(
  holderInfo: string,
): Promise<LockAcquisitionResult> {
  // Check if lock exists and is still valid
  if (currentLock && !isLockExpired()) {
    console.log(
      `[TradingLock] Lock already held by "${currentLock.holderInfo}" (acquired ${new Date(currentLock.acquiredAt).toISOString()}). Skipping.`,
    );
    return {
      acquired: false,
      lockId: null,
      existingLock: {
        lockId: currentLock.lockId,
        acquiredAt: new Date(currentLock.acquiredAt).toISOString(),
        expiresAt: new Date(currentLock.expiresAt).toISOString(),
        holderInfo: currentLock.holderInfo,
        isExpired: false,
      },
    };
  }

  // Try DynamoDB conditional write if available
  const dynamoResult = await tryDynamoLock(holderInfo);
  if (dynamoResult !== null) {
    return dynamoResult;
  }

  // Fallback to in-memory lock
  const lockId = generateLockId();
  const now = Date.now();

  currentLock = {
    lockId,
    acquiredAt: now,
    expiresAt: now + LOCK_TTL_MS,
    holderInfo,
  };

  console.log(
    `[TradingLock] Lock acquired: ${lockId} by "${holderInfo}" (expires ${new Date(currentLock.expiresAt).toISOString()})`,
  );

  return { acquired: true, lockId, existingLock: null };
}

/**
 * Release the trading lock.
 *
 * Only the holder (matching lockId) can release the lock.
 * Returns true if released, false if the lock wasn't held or didn't match.
 */
export async function releaseLock(lockId: string): Promise<boolean> {
  if (!currentLock || currentLock.lockId !== lockId) {
    console.warn(
      `[TradingLock] Cannot release: lock ${lockId} not found or doesn't match current lock`,
    );
    return false;
  }

  const holderInfo = currentLock.holderInfo;
  currentLock = null;

  // Also release in DynamoDB if available
  await tryDynamoRelease(lockId);

  console.log(
    `[TradingLock] Lock released: ${lockId} (was held by "${holderInfo}")`,
  );
  return true;
}

/**
 * Force release the lock regardless of holder.
 * Admin/emergency use only.
 */
export async function forceReleaseLock(): Promise<boolean> {
  if (!currentLock) {
    console.log(`[TradingLock] No lock to force-release`);
    return false;
  }

  const lockId = currentLock.lockId;
  const holderInfo = currentLock.holderInfo;
  currentLock = null;

  await tryDynamoRelease(lockId);

  console.warn(
    `[TradingLock] Lock FORCE RELEASED: ${lockId} (was held by "${holderInfo}")`,
  );
  return true;
}

/**
 * Get current lock status.
 */
export function getLockStatus(): {
  isLocked: boolean;
  lock: LockInfo | null;
} {
  if (!currentLock) {
    return { isLocked: false, lock: null };
  }

  const expired = isLockExpired();

  // If expired, auto-release
  if (expired) {
    console.log(
      `[TradingLock] Lock ${currentLock.lockId} expired, auto-releasing`,
    );
    currentLock = null;
    return { isLocked: false, lock: null };
  }

  return {
    isLocked: true,
    lock: {
      lockId: currentLock.lockId,
      acquiredAt: new Date(currentLock.acquiredAt).toISOString(),
      expiresAt: new Date(currentLock.expiresAt).toISOString(),
      holderInfo: currentLock.holderInfo,
      isExpired: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Higher-Level Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a function while holding the trading lock.
 *
 * Automatically acquires the lock before execution and releases it after,
 * even if the function throws an error.
 *
 * Returns null if the lock could not be acquired.
 */
export async function withTradingLock<T>(
  holderInfo: string,
  fn: () => Promise<T>,
): Promise<{ result: T; lockId: string } | null> {
  const acquisition = await acquireLock(holderInfo);

  if (!acquisition.acquired || !acquisition.lockId) {
    console.log(
      `[TradingLock] Could not acquire lock for "${holderInfo}". Skipping execution.`,
    );
    return null;
  }

  const lockId = acquisition.lockId;

  try {
    const result = await fn();
    return { result, lockId };
  } finally {
    await releaseLock(lockId);
  }
}

// ---------------------------------------------------------------------------
// DynamoDB Operations (optional, for Lambda deployments)
// ---------------------------------------------------------------------------

/**
 * Try to acquire lock in DynamoDB using conditional writes.
 * Returns null if DynamoDB is not available (falls back to in-memory).
 */
async function tryDynamoLock(
  holderInfo: string,
): Promise<LockAcquisitionResult | null> {
  // Only use DynamoDB in Lambda environment
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return null;
  }

  try {
    const { DynamoDBClient, PutItemCommand } = await import(
      "@aws-sdk/client-dynamodb"
    );

    const client = new DynamoDBClient({});
    const lockId = generateLockId();
    const now = Date.now();
    const expiresAt = now + LOCK_TTL_MS;
    const ttlSeconds = Math.floor(expiresAt / 1000);

    await client.send(
      new PutItemCommand({
        TableName: DYNAMO_TABLE,
        Item: {
          agentId: { S: LOCK_PK },
          lockId: { S: lockId },
          acquiredAt: { S: new Date(now).toISOString() },
          expiresAt: { S: new Date(expiresAt).toISOString() },
          holderInfo: { S: holderInfo },
          ttl: { N: String(ttlSeconds) },
          status: { S: "active" },
          lastTradeTimestamp: { S: new Date(now).toISOString() },
        },
        ConditionExpression:
          "attribute_not_exists(agentId) OR expiresAt < :now",
        ExpressionAttributeValues: {
          ":now": { S: new Date(now).toISOString() },
        },
      }),
    );

    // Also set in-memory
    currentLock = { lockId, acquiredAt: now, expiresAt, holderInfo };

    console.log(
      `[TradingLock] DynamoDB lock acquired: ${lockId} by "${holderInfo}"`,
    );
    return { acquired: true, lockId, existingLock: null };
  } catch (err) {
    // ConditionalCheckFailedException means another instance holds the lock
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      console.log(
        `[TradingLock] DynamoDB lock held by another instance. Skipping.`,
      );
      return {
        acquired: false,
        lockId: null,
        existingLock: null,
      };
    }

    // Other DynamoDB errors — fall back to in-memory
    console.warn(
      `[TradingLock] DynamoDB lock failed, falling back to in-memory: ${errorMessage(err)}`,
    );
    return null;
  }
}

/**
 * Try to release lock in DynamoDB.
 */
async function tryDynamoRelease(lockId: string): Promise<void> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }

  try {
    const { DynamoDBClient, DeleteItemCommand } = await import(
      "@aws-sdk/client-dynamodb"
    );

    const client = new DynamoDBClient({});

    await client.send(
      new DeleteItemCommand({
        TableName: DYNAMO_TABLE,
        Key: {
          agentId: { S: LOCK_PK },
        },
        ConditionExpression: "lockId = :lockId",
        ExpressionAttributeValues: {
          ":lockId": { S: lockId },
        },
      }),
    );

    console.log(`[TradingLock] DynamoDB lock released: ${lockId}`);
  } catch (err) {
    // Not critical — in-memory lock is already released
    console.warn(
      `[TradingLock] DynamoDB release failed (non-critical): ${errorMessage(err)}`,
    );
  }
}
