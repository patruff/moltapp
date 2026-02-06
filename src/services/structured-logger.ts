/**
 * Structured Logging & Metrics Pipeline
 *
 * CloudWatch-ready JSON logging with structured events
 * that can be queried, filtered, and alarmed on.
 *
 * Features:
 * - JSON structured logs (CloudWatch Insights compatible)
 * - Log levels: DEBUG, INFO, WARN, ERROR, FATAL
 * - Log sampling for high-frequency events
 * - Ring buffer for recent logs (in-memory access)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface StructuredLogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Service/module that generated the log */
  service: string;
  /** Human-readable message */
  message: string;
  /** Trading round ID (if applicable) */
  roundId?: string;
  /** Agent ID (if applicable) */
  agentId?: string;
  /** Trace ID for request correlation */
  traceId?: string;
  /** Duration in ms (for timing events) */
  durationMs?: number;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Error details */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface MetricEntry {
  /** Metric name (CloudWatch convention: Namespace/MetricName) */
  name: string;
  /** Metric value */
  value: number;
  /** Unit of measurement */
  unit: MetricUnit;
  /** Dimensions for metric filtering */
  dimensions: Record<string, string>;
  /** Timestamp */
  timestamp: string;
}

export type MetricUnit =
  | "Count"
  | "Milliseconds"
  | "Seconds"
  | "Percent"
  | "Bytes"
  | "None";

export interface LoggerConfig {
  /** Minimum log level to output (default: INFO, DEBUG in dev) */
  minLevel: LogLevel;
  /** Whether to output as JSON (true for production/Lambda) */
  jsonOutput: boolean;
  /** Whether to include stack traces in errors */
  includeStackTraces: boolean;
  /** Sample rate for DEBUG logs (0-1, 1 = log all) */
  debugSampleRate: number;
  /** Maximum number of logs to keep in memory ring buffer */
  ringBufferSize: number;
}

export interface LoggerStats {
  totalLogs: number;
  logsByLevel: Record<LogLevel, number>;
  metricsEmitted: number;
  roundMetricsEmitted: number;
  sampledOut: number;
  errorsLogged: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

const isProduction = process.env.NODE_ENV === "production";
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const config: LoggerConfig = {
  minLevel: isProduction ? "INFO" : "DEBUG",
  jsonOutput: isProduction || isLambda,
  includeStackTraces: !isProduction,
  debugSampleRate: isProduction ? 0.1 : 1.0,
  ringBufferSize: 500,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const ringBuffer: StructuredLogEntry[] = [];
const metricBuffer: MetricEntry[] = [];

let stats: LoggerStats = {
  totalLogs: 0,
  logsByLevel: { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 },
  metricsEmitted: 0,
  roundMetricsEmitted: 0,
  sampledOut: 0,
  errorsLogged: 0,
};

// ---------------------------------------------------------------------------
// Core Logging
// ---------------------------------------------------------------------------

/**
 * Log a structured entry.
 */
function log(
  level: LogLevel,
  service: string,
  message: string,
  data?: Record<string, unknown>,
  error?: Error,
): void {
  // Level filtering
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[config.minLevel]) {
    return;
  }

  // Debug sampling
  if (level === "DEBUG" && config.debugSampleRate < 1) {
    if (Math.random() > config.debugSampleRate) {
      stats.sampledOut++;
      return;
    }
  }

  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    data,
  };

  if (error) {
    entry.error = {
      message: error.message,
      code: (error as Error & { code?: string }).code,
      stack: config.includeStackTraces ? error.stack : undefined,
    };
    stats.errorsLogged++;
  }

  // Track stats
  stats.totalLogs++;
  stats.logsByLevel[level]++;

  // Add to ring buffer
  ringBuffer.push(entry);
  if (ringBuffer.length > config.ringBufferSize) {
    ringBuffer.splice(0, ringBuffer.length - config.ringBufferSize);
  }

  // Output
  if (config.jsonOutput) {
    // JSON output for CloudWatch
    const output = JSON.stringify(entry);
    if (level === "ERROR" || level === "FATAL") {
      console.error(output);
    } else if (level === "WARN") {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    // Pretty output for development
    const prefix = `[${level}][${service}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    const errorStr = error ? ` ERROR: ${error.message}` : "";

    if (level === "ERROR" || level === "FATAL") {
      console.error(`${prefix} ${message}${dataStr}${errorStr}`);
    } else if (level === "WARN") {
      console.warn(`${prefix} ${message}${dataStr}${errorStr}`);
    } else {
      console.log(`${prefix} ${message}${dataStr}${errorStr}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Log Level Methods
// ---------------------------------------------------------------------------

export const logger = {
  debug(service: string, message: string, data?: Record<string, unknown>): void {
    log("DEBUG", service, message, data);
  },

  info(service: string, message: string, data?: Record<string, unknown>): void {
    log("INFO", service, message, data);
  },

  warn(service: string, message: string, data?: Record<string, unknown>): void {
    log("WARN", service, message, data);
  },

  error(service: string, message: string, error?: Error, data?: Record<string, unknown>): void {
    log("ERROR", service, message, data, error);
  },

  fatal(service: string, message: string, error?: Error, data?: Record<string, unknown>): void {
    log("FATAL", service, message, data, error);
  },
};

// ---------------------------------------------------------------------------
// Log Access & Querying
// ---------------------------------------------------------------------------

/**
 * Get recent logs from the ring buffer.
 */
export function getRecentLogs(filters?: {
  level?: LogLevel;
  service?: string;
  roundId?: string;
  agentId?: string;
  limit?: number;
}): StructuredLogEntry[] {
  let filtered = [...ringBuffer];

  if (filters?.level) {
    const minPriority = LOG_LEVEL_PRIORITY[filters.level];
    filtered = filtered.filter(
      (l) => LOG_LEVEL_PRIORITY[l.level] >= minPriority,
    );
  }
  if (filters?.service) {
    filtered = filtered.filter((l) => l.service === filters.service);
  }
  if (filters?.roundId) {
    filtered = filtered.filter((l) => l.roundId === filters.roundId);
  }
  if (filters?.agentId) {
    filtered = filtered.filter((l) => l.agentId === filters.agentId);
  }

  const limit = filters?.limit ?? 50;
  return filtered.slice(-limit);
}

/**
 * Get recent metrics from the buffer.
 */
export function getRecentMetrics(limit = 50): MetricEntry[] {
  return metricBuffer.slice(-limit);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update logger configuration.
 */
export function configureLogger(updates: Partial<LoggerConfig>): LoggerConfig {
  Object.assign(config, updates);
  return { ...config };
}

/**
 * Get current logger configuration.
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

// ---------------------------------------------------------------------------
// Metrics & Stats
// ---------------------------------------------------------------------------

/**
 * Get logger statistics.
 */
export function getLoggerStats(): LoggerStats {
  return { ...stats, logsByLevel: { ...stats.logsByLevel } };
}

/**
 * Reset logger statistics.
 */
export function resetLoggerStats(): void {
  stats = {
    totalLogs: 0,
    logsByLevel: { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 },
    metricsEmitted: 0,
    roundMetricsEmitted: 0,
    sampledOut: 0,
    errorsLogged: 0,
  };
  ringBuffer.length = 0;
  metricBuffer.length = 0;
}
