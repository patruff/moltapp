/**
 * Agent Labels Configuration
 *
 * Centralized mapping of agent IDs to human-readable display names.
 * Used across all benchmark API routes (v28-v37) for consistent labeling.
 */

export const AGENT_LABELS: Record<string, string> = {
  "claude-value-investor": "Claude ValueBot",
  "gpt-momentum-trader": "GPT MomentumBot",
  "grok-contrarian": "Grok ContrarianBot",
};
