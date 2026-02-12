/**
 * Discord Trade Notifier
 *
 * Real-time Discord webhook notifications for MoltApp trading events.
 * Sends rich embeds to Discord channels for:
 *
 * - Trade executions (buy/sell with agent details)
 * - Trading round summaries
 * - Circuit breaker activations
 * - Agent disagreements
 * - Daily performance summaries
 * - System alerts (errors, degraded health)
 *
 * Uses Discord's webhook API with embed formatting.
 * No bot token needed — just a webhook URL.
 *
 * Configuration:
 * - DISCORD_WEBHOOK_URL: Main trading channel webhook
 * - DISCORD_ALERTS_WEBHOOK_URL: Alerts/errors channel (optional, falls back to main)
 */

import { pnlSign } from "../lib/format-utils.ts";
import { errorMessage } from "../lib/errors.ts";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
  thumbnail?: { url: string };
  author?: { name: string; icon_url?: string; url?: string };
  url?: string;
}

export interface DiscordWebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

export interface TradeNotification {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  executed: boolean;
  txSignature?: string;
  filledPrice?: number;
  usdcAmount?: number;
  roundId?: string;
}

export interface RoundSummaryNotification {
  roundId: string;
  timestamp: string;
  durationMs: number;
  results: Array<{
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
    executed: boolean;
    txSignature?: string;
  }>;
  errors: string[];
  circuitBreakerActivations: number;
  consensus: "unanimous" | "majority" | "split" | "no_trades";
}

export interface CircuitBreakerNotification {
  agentId: string;
  agentName: string;
  breakerType: string;
  reason: string;
  originalAction: string;
  originalSymbol: string;
  threshold: string;
  actualValue: string;
}

export interface DisagreementNotification {
  roundId: string;
  symbol: string;
  agents: Array<{
    agentName: string;
    action: string;
    confidence: number;
  }>;
}

export interface DailySummaryNotification {
  date: string;
  totalRounds: number;
  totalTrades: number;
  agentPerformance: Array<{
    agentName: string;
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
    pnlPercent: number;
  }>;
  topStock: string;
  topStockTrades: number;
  circuitBreakerTotal: number;
}

export interface DiscordNotifierConfig {
  webhookUrl: string;
  alertsWebhookUrl?: string;
  username: string;
  avatarUrl?: string;
  enabled: boolean;
  /** Minimum confidence level to notify (skip low-confidence holds) */
  minConfidenceToNotify: number;
  /** Whether to include trade reasoning in notifications */
  includeReasoning: boolean;
  /** Rate limit: max messages per minute */
  maxMessagesPerMinute: number;
}

export interface DiscordNotifierMetrics {
  totalSent: number;
  totalFailed: number;
  totalRateLimited: number;
  lastSentAt: string | null;
  lastError: string | null;
  messagesSentLastMinute: number;
  config: Omit<DiscordNotifierConfig, "webhookUrl" | "alertsWebhookUrl"> & {
    webhookConfigured: boolean;
    alertsWebhookConfigured: boolean;
  };
}

// ---------------------------------------------------------------------------
// Constants — Discord embed colors
// ---------------------------------------------------------------------------

const COLORS = {
  BUY: 0x00c853, // Green
  SELL: 0xff1744, // Red
  HOLD: 0x9e9e9e, // Grey
  ROUND_OK: 0x2979ff, // Blue
  ROUND_ERROR: 0xff6d00, // Orange
  CIRCUIT_BREAKER: 0xffab00, // Amber
  DISAGREEMENT: 0xd500f9, // Purple
  DAILY_SUMMARY: 0x00b8d4, // Cyan
  SYSTEM_ALERT: 0xff1744, // Red
  SYSTEM_OK: 0x00c853, // Green
} as const;

const AGENT_EMOJIS: Record<string, string> = {
  claude: "🧠",
  gpt: "🤖",
  grok: "⚡",
};

const ACTION_EMOJIS: Record<string, string> = {
  buy: "📈",
  sell: "📉",
  hold: "⏸️",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: DiscordNotifierConfig = {
  webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? "",
  alertsWebhookUrl: process.env.DISCORD_ALERTS_WEBHOOK_URL,
  username: "MoltApp Trading Bot",
  avatarUrl: undefined,
  enabled: true,
  minConfidenceToNotify: 0,
  includeReasoning: true,
  maxMessagesPerMinute: 30,
};

let totalSent = 0;
let totalFailed = 0;
let totalRateLimited = 0;
let lastSentAt: string | null = null;
let lastError: string | null = null;
const recentTimestamps: number[] = [];

// ---------------------------------------------------------------------------
// Core — Send to Discord
// ---------------------------------------------------------------------------

/**
 * Send a webhook payload to Discord with rate limiting and error handling.
 */
async function sendToDiscord(
  payload: DiscordWebhookPayload,
  useAlertsChannel = false,
): Promise<boolean> {
  const url = useAlertsChannel
    ? config.alertsWebhookUrl || config.webhookUrl
    : config.webhookUrl;

  if (!url || !config.enabled) {
    return false;
  }

  // Rate limit check
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const recentCount = countByCondition(recentTimestamps, (t) => t > oneMinuteAgo);

  if (recentCount >= config.maxMessagesPerMinute) {
    totalRateLimited++;
    console.warn(
      `[DiscordNotifier] Rate limited (${recentCount}/${config.maxMessagesPerMinute} per minute)`,
    );
    return false;
  }

  // Apply defaults
  const finalPayload: DiscordWebhookPayload = {
    username: config.username,
    avatar_url: config.avatarUrl,
    ...payload,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok || response.status === 204) {
      totalSent++;
      lastSentAt = new Date().toISOString();
      recentTimestamps.push(now);
      // Prune old timestamps
      while (recentTimestamps.length > 0 && recentTimestamps[0] < oneMinuteAgo) {
        recentTimestamps.shift();
      }
      return true;
    }

    // Discord rate limit (429)
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseFloat(retryAfter) * 1000 : 5000;
      console.warn(
        `[DiscordNotifier] Discord rate limit hit, retry after ${waitMs}ms`,
      );

      // Wait and retry once
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const retryResp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload),
        signal: AbortSignal.timeout(10_000),
      });

      if (retryResp.ok || retryResp.status === 204) {
        totalSent++;
        lastSentAt = new Date().toISOString();
        recentTimestamps.push(Date.now());
        return true;
      }

      throw new Error(`Discord retry failed: HTTP ${retryResp.status}`);
    }

    const body = await response.text().catch(() => "no body");
    throw new Error(`Discord webhook failed: HTTP ${response.status} — ${body}`);
  } catch (err) {
    totalFailed++;
    lastError = errorMessage(err);
    console.error(`[DiscordNotifier] Send failed: ${lastError}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Notification Builders
// ---------------------------------------------------------------------------

/**
 * Send a trade execution notification to Discord.
 */
export async function notifyTradeExecution(
  trade: TradeNotification,
): Promise<boolean> {
  // Skip low-confidence holds
  if (
    trade.action === "hold" &&
    trade.confidence < config.minConfidenceToNotify
  ) {
    return false;
  }

  const agentKey = trade.agentName.toLowerCase().split(" ")[0];
  const agentEmoji = AGENT_EMOJIS[agentKey] ?? "🤖";
  const actionEmoji = ACTION_EMOJIS[trade.action] ?? "❓";

  const color =
    trade.action === "buy"
      ? COLORS.BUY
      : trade.action === "sell"
        ? COLORS.SELL
        : COLORS.HOLD;

  const fields: DiscordEmbed["fields"] = [
    { name: "Action", value: `${actionEmoji} ${trade.action.toUpperCase()}`, inline: true },
    { name: "Stock", value: trade.symbol, inline: true },
    { name: "Confidence", value: `${trade.confidence}%`, inline: true },
  ];

  if (trade.action !== "hold") {
    fields.push({
      name: "Quantity",
      value: trade.quantity.toFixed(4),
      inline: true,
    });
  }

  if (trade.filledPrice !== undefined) {
    fields.push({
      name: "Price",
      value: `$${trade.filledPrice.toFixed(2)}`,
      inline: true,
    });
  }

  if (trade.usdcAmount !== undefined) {
    fields.push({
      name: "Value",
      value: `$${trade.usdcAmount.toFixed(2)}`,
      inline: true,
    });
  }

  fields.push({
    name: "Status",
    value: trade.executed ? "✅ Executed" : "❌ Failed",
    inline: true,
  });

  if (trade.txSignature) {
    fields.push({
      name: "Transaction",
      value: `[View on Solscan](https://solscan.io/tx/${trade.txSignature})`,
      inline: false,
    });
  }

  if (config.includeReasoning && trade.reasoning) {
    const truncatedReasoning =
      trade.reasoning.length > 256
        ? trade.reasoning.slice(0, 253) + "..."
        : trade.reasoning;
    fields.push({
      name: "Reasoning",
      value: truncatedReasoning,
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: `${agentEmoji} ${trade.agentName} — ${trade.action.toUpperCase()} ${trade.symbol}`,
    color,
    fields,
    footer: {
      text: trade.roundId
        ? `Round: ${trade.roundId.slice(0, 20)}`
        : "MoltApp Trading",
    },
    timestamp: new Date().toISOString(),
  };

  return sendToDiscord({ embeds: [embed] });
}

/**
 * Send a round summary notification to Discord.
 */
export async function notifyRoundSummary(
  round: RoundSummaryNotification,
): Promise<boolean> {
  const hasErrors = round.errors.length > 0;
  const color = hasErrors ? COLORS.ROUND_ERROR : COLORS.ROUND_OK;

  const consensusEmoji =
    round.consensus === "unanimous"
      ? "🤝"
      : round.consensus === "majority"
        ? "📊"
        : round.consensus === "split"
          ? "⚔️"
          : "😴";

  // Build agent decision lines
  const decisionLines = round.results.map((r) => {
    const actionEmoji = ACTION_EMOJIS[r.action] ?? "❓";
    const statusIcon = r.executed ? "✅" : "❌";
    const txLink = r.txSignature
      ? ` [tx](https://solscan.io/tx/${r.txSignature})`
      : "";
    return `${statusIcon} **${r.agentName}**: ${actionEmoji} ${r.action.toUpperCase()} ${r.symbol} (${r.confidence}%)${txLink}`;
  });

  const fields: DiscordEmbed["fields"] = [
    {
      name: "Agent Decisions",
      value: decisionLines.join("\n") || "No decisions",
      inline: false,
    },
    {
      name: "Consensus",
      value: `${consensusEmoji} ${round.consensus}`,
      inline: true,
    },
    {
      name: "Duration",
      value: `${(round.durationMs / 1000).toFixed(1)}s`,
      inline: true,
    },
    {
      name: "Circuit Breakers",
      value: round.circuitBreakerActivations > 0
        ? `⚠️ ${round.circuitBreakerActivations} triggered`
        : "✅ None",
      inline: true,
    },
  ];

  if (round.errors.length > 0) {
    fields.push({
      name: "Errors",
      value: round.errors
        .slice(0, 3)
        .map((e) => `❌ ${e.slice(0, 100)}`)
        .join("\n"),
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: `📋 Trading Round Complete`,
    description: `Round \`${round.roundId.slice(0, 24)}\` — ${round.results.length} agents participated`,
    color,
    fields,
    footer: { text: "MoltApp Autonomous Trading" },
    timestamp: round.timestamp,
  };

  return sendToDiscord({ embeds: [embed] });
}

/**
 * Send a circuit breaker activation notification.
 */
export async function notifyCircuitBreaker(
  cb: CircuitBreakerNotification,
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `⚠️ Circuit Breaker — ${cb.breakerType}`,
    description: `**${cb.agentName}**'s trade was blocked by safety controls`,
    color: COLORS.CIRCUIT_BREAKER,
    fields: [
      { name: "Agent", value: cb.agentName, inline: true },
      {
        name: "Blocked Action",
        value: `${cb.originalAction.toUpperCase()} ${cb.originalSymbol}`,
        inline: true,
      },
      { name: "Breaker Type", value: cb.breakerType, inline: true },
      { name: "Reason", value: cb.reason, inline: false },
      { name: "Threshold", value: cb.threshold, inline: true },
      { name: "Actual Value", value: cb.actualValue, inline: true },
    ],
    footer: { text: "MoltApp Risk Management" },
    timestamp: new Date().toISOString(),
  };

  return sendToDiscord({ embeds: [embed] }, true);
}

/**
 * Send an agent disagreement notification (agents take opposite positions).
 */
export async function notifyAgentDisagreement(
  disagreement: DisagreementNotification,
): Promise<boolean> {
  const agentLines = disagreement.agents.map((a) => {
    const actionEmoji = ACTION_EMOJIS[a.action] ?? "❓";
    return `**${a.agentName}**: ${actionEmoji} ${a.action.toUpperCase()} (${a.confidence}%)`;
  });

  const embed: DiscordEmbed = {
    title: `⚔️ Agent Disagreement — ${disagreement.symbol}`,
    description: `Agents took opposite positions on **${disagreement.symbol}**!`,
    color: COLORS.DISAGREEMENT,
    fields: [
      {
        name: "Positions",
        value: agentLines.join("\n"),
        inline: false,
      },
      {
        name: "Round",
        value: `\`${disagreement.roundId.slice(0, 24)}\``,
        inline: true,
      },
    ],
    footer: { text: "MoltApp Agent Competition" },
    timestamp: new Date().toISOString(),
  };

  return sendToDiscord({ embeds: [embed] });
}

/**
 * Send a daily performance summary to Discord.
 */
export async function notifyDailySummary(
  summary: DailySummaryNotification,
): Promise<boolean> {
  const agentLines = summary.agentPerformance.map((a) => {
    const pnlEmoji = a.pnl >= 0 ? "📈" : "📉";
    const sign = pnlSign(a.pnl);
    return `**${a.agentName}**: ${a.trades} trades, ${a.wins}W/${a.losses}L, ${pnlEmoji} ${sign}$${a.pnl.toFixed(2)} (${sign}${a.pnlPercent.toFixed(2)}%)`;
  });

  // Sort by P&L descending for ranking
  const ranked = [...summary.agentPerformance].sort(
    (a, b) => b.pnl - a.pnl,
  );
  const winner = ranked[0];

  const embed: DiscordEmbed = {
    title: `📊 Daily Summary — ${summary.date}`,
    description: winner
      ? `🏆 **${winner.agentName}** leads with ${pnlSign(winner.pnl)}$${winner.pnl.toFixed(2)}`
      : "No agent activity today",
    color: COLORS.DAILY_SUMMARY,
    fields: [
      {
        name: "Agent Performance",
        value: agentLines.join("\n") || "No data",
        inline: false,
      },
      {
        name: "Trading Rounds",
        value: String(summary.totalRounds),
        inline: true,
      },
      {
        name: "Total Trades",
        value: String(summary.totalTrades),
        inline: true,
      },
      {
        name: "Most Traded",
        value: `${summary.topStock} (${summary.topStockTrades}x)`,
        inline: true,
      },
      {
        name: "Circuit Breakers",
        value:
          summary.circuitBreakerTotal > 0
            ? `⚠️ ${summary.circuitBreakerTotal} triggered`
            : "✅ None",
        inline: true,
      },
    ],
    footer: { text: "MoltApp Autonomous Trading" },
    timestamp: new Date().toISOString(),
  };

  return sendToDiscord({ embeds: [embed] });
}

/**
 * Send a system alert notification (degraded health, errors, etc.).
 */
export async function notifySystemAlert(params: {
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}): Promise<boolean> {
  const severityEmoji =
    params.severity === "critical"
      ? "🚨"
      : params.severity === "warning"
        ? "⚠️"
        : "ℹ️";

  const color =
    params.severity === "critical"
      ? COLORS.SYSTEM_ALERT
      : params.severity === "warning"
        ? COLORS.CIRCUIT_BREAKER
        : COLORS.SYSTEM_OK;

  const embed: DiscordEmbed = {
    title: `${severityEmoji} ${params.title}`,
    description: params.description,
    color,
    fields: params.fields,
    footer: { text: `Severity: ${params.severity.toUpperCase()}` },
    timestamp: new Date().toISOString(),
  };

  return sendToDiscord({ embeds: [embed] }, true);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update Discord notifier configuration.
 */
export function configureDiscordNotifier(
  updates: Partial<DiscordNotifierConfig>,
): DiscordNotifierConfig {
  config = { ...config, ...updates };
  console.log(
    `[DiscordNotifier] Config updated: enabled=${config.enabled}, ` +
      `minConfidence=${config.minConfidenceToNotify}, ` +
      `includeReasoning=${config.includeReasoning}`,
  );
  return config;
}

/**
 * Get current metrics for the Discord notifier.
 */
export function getDiscordNotifierMetrics(): DiscordNotifierMetrics {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const messagesSentLastMinute = recentTimestamps.filter(
    (t) => t > oneMinuteAgo,
  ).length;

  return {
    totalSent,
    totalFailed,
    totalRateLimited,
    lastSentAt,
    lastError,
    messagesSentLastMinute,
    config: {
      enabled: config.enabled,
      username: config.username,
      minConfidenceToNotify: config.minConfidenceToNotify,
      includeReasoning: config.includeReasoning,
      maxMessagesPerMinute: config.maxMessagesPerMinute,
      webhookConfigured: !!config.webhookUrl,
      alertsWebhookConfigured: !!config.alertsWebhookUrl,
    },
  };
}

/**
 * Test the Discord webhook by sending a test message.
 */
export async function testDiscordWebhook(): Promise<{
  success: boolean;
  error?: string;
}> {
  const embed: DiscordEmbed = {
    title: "🧪 MoltApp Webhook Test",
    description:
      "Discord notifications are working! You'll receive trade alerts, round summaries, and system notifications here.",
    color: COLORS.SYSTEM_OK,
    fields: [
      {
        name: "Status",
        value: "✅ Connected",
        inline: true,
      },
      {
        name: "Bot Name",
        value: config.username,
        inline: true,
      },
    ],
    footer: { text: "MoltApp Trading Platform" },
    timestamp: new Date().toISOString(),
  };

  const success = await sendToDiscord({ embeds: [embed] });
  return {
    success,
    error: success ? undefined : lastError ?? "Unknown error",
  };
}
