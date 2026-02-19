/**
 * Agent Debate System
 *
 * The showpiece social feature of MoltApp. When AI trading agents disagree
 * on a stock, they engage in structured debates — complete with opening
 * arguments, rebuttals, evidence, and a scored verdict. Each agent argues
 * from its distinct investment philosophy:
 *
 *   - Claude ValueBot (Anthropic) — Conservative value investor. Focuses on
 *     fundamentals, P/E ratios, intrinsic value, margin of safety. Speaks
 *     with measured Buffett-like wisdom.
 *
 *   - GPT MomentumBot (OpenAI) — Aggressive momentum trader. Focuses on
 *     price action, volume trends, technical breakouts, growth narrative.
 *     Confident, fast-talking, chart-obsessed.
 *
 *   - Grok ContrarianBot (xAI) — Contrarian with dry wit. Focuses on
 *     sentiment extremes, overlooked catalysts, consensus divergence.
 *     References market history and loves unpopular trades.
 *
 * Debates are deterministically generated from real agent decision data —
 * no LLM calls required. Arguments, rebuttals, and verdicts are synthesized
 * from each agent's actual reasoning, confidence, and trading history.
 */

import { db } from "../db/index.ts";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, ID_RANDOM_LENGTH_STANDARD, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and } from "drizzle-orm";
import { getAgentConfigs, getAgentConfig, getMarketData } from "../agents/orchestrator.ts";
import { countByCondition, getTopKey, round2, sortEntriesDescending } from "../lib/math-utils.ts";
import type { MarketData } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Stance Classification Thresholds
 *
 * Control how agent trading patterns are classified as bullish/bearish based
 * on percentage of buy/sell decisions in recent activity.
 */

/**
 * Strongly Bullish/Bearish Threshold
 *
 * When buy% or sell% exceeds this threshold (60%), classify agent stance as
 * "Strongly Bullish" or "Strongly Bearish".
 *
 * Example: 12 buys out of 20 decisions = 60% buy rate → "Strongly Bullish"
 *
 * Tuning impact: Lower to 55% to trigger "Strongly" labels earlier.
 */
const STANCE_STRONG_THRESHOLD = 60;

/**
 * Moderately Bullish/Bearish Threshold
 *
 * When buy% or sell% exceeds this threshold (40%), classify agent stance as
 * "Moderately Bullish" or "Moderately Bearish".
 *
 * Example: 8 buys out of 20 decisions = 40% buy rate → "Moderately Bullish"
 *
 * Tuning impact: Raise to 45% to require stronger signal for "Moderate" labels.
 */
const STANCE_MODERATE_THRESHOLD = 40;

/**
 * Debate Verdict Score Margins
 *
 * Control how debate winners are classified based on score difference.
 */

/**
 * Decisive Victory Margin
 *
 * When winner's score exceeds runner-up by this margin (15 points), classify
 * debate as "decisive victory" with strong winner narrative.
 *
 * Example: Winner 85, Runner-up 68 = 17 point margin → "Decisive victory"
 *
 * Tuning impact: Lower to 12 to trigger "decisive" label more often.
 */
const DEBATE_DECISIVE_MARGIN = 15;

/**
 * Close Debate Margin
 *
 * When winner's score exceeds runner-up by less than this margin (5 points),
 * classify debate as "razor-thin" / essentially a draw.
 *
 * Example: Winner 78, Runner-up 75 = 3 point margin → "Razor-thin margin"
 *
 * Tuning impact: Raise to 8 to require larger gap for "clear winner" classification.
 */
const DEBATE_CLOSE_MARGIN = 5;

/**
 * Price Movement Resolution Threshold
 *
 * Minimum price change percentage (1%) to classify a debate as "resolved".
 * Below this threshold, outcome is considered inconclusive.
 *
 * Example: Price moved from $100 to $101.50 = 1.5% → resolved
 *
 * Tuning impact: Raise to 2% to require larger moves for resolution.
 */
const PRICE_RESOLUTION_THRESHOLD = 1;

/**
 * Top Picks Display Limit
 *
 * Maximum number of top symbol picks to display in market outlook generation.
 * Used when showing highest-confidence trading opportunities across agents.
 *
 * Example: "Top picks: AAPL (buy, 87%), MSFT (buy, 82%), TSLA (sell, 79%)"
 *
 * Tuning impact: Increase to 5 for broader market coverage, decrease to 2
 * for more focused highlights.
 */
const TOP_PICKS_DISPLAY_LIMIT = 3;

/**
 * Consensus Agreement Thresholds
 *
 * Control when agent agreement counts as consensus vs disagreement.
 */

/**
 * Minimum Agents for Debate
 *
 * Require at least this many agents (2) for a meaningful debate. Below this,
 * no debate is generated (insufficient participants).
 *
 * Example: 2 agents with different positions → debate triggered
 *
 * Tuning impact: Raise to 3 to require all agents for debates (stricter).
 */
const MIN_AGENTS_FOR_DEBATE = 2;

/**
 * Minimum Agents for Consensus Area
 *
 * Require at least this many agents (2) agreeing on a symbol for it to count
 * as a "consensus area" in market outlook.
 *
 * Example: 2 agents both say "buy AAPL" → consensus area
 *
 * Tuning impact: Raise to 3 to require unanimous agreement for consensus.
 */
const MIN_AGENTS_FOR_CONSENSUS = 2;

/**
 * Minimum Agents for Majority Calculation
 *
 * When computing contrarianism score, require at least this many agents (3)
 * in a round to calculate majority position.
 *
 * Example: Round with 3 agents, 2 say "buy" → majority is "buy"
 *
 * Tuning impact: Lower to 2 to allow majority calculation with fewer agents.
 */
const MIN_AGENTS_FOR_MAJORITY = 3;

/**
 * Overall Market Sentiment Thresholds
 *
 * Control classification of aggregate agent bullishness into overall sentiment.
 */

/**
 * Bullish Sentiment Threshold
 *
 * When average agent bullish% exceeds this threshold (60%), classify overall
 * market sentiment as "Bullish".
 *
 * Example: Avg bullish% = 65% → "Bullish" market sentiment
 *
 * Tuning impact: Lower to 55% to trigger "Bullish" classification earlier.
 */
const SENTIMENT_BULLISH_THRESHOLD = 60;

/**
 * Bearish Sentiment Threshold
 *
 * When average agent bullish% falls below this threshold (40%), classify
 * overall market sentiment as "Bearish".
 *
 * Example: Avg bullish% = 35% → "Bearish" market sentiment
 *
 * Tuning impact: Raise to 45% to require stronger bearish signal.
 */
const SENTIMENT_BEARISH_THRESHOLD = 40;

/**
 * Debate Scoring Dimension Weights
 *
 * Each debate participant is scored on 4 dimensions (0-25 points each).
 */

/**
 * Maximum Points Per Dimension
 *
 * Each of the 4 scoring dimensions (conviction, reasoning, data usage, risk
 * awareness) awards up to this many points (25), for a total of 100.
 *
 * Example: 25 conviction + 20 reasoning + 15 data + 18 risk = 78 total
 *
 * Tuning impact: Increase to 30 to allow higher total scores (120 max).
 */
const DEBATE_SCORE_MAX_PER_DIMENSION = 25;

/**
 * Argument Richness Normalization
 *
 * Normalize supporting points count to 1.0 when this many points (5) are present.
 * Used to score reasoning depth.
 *
 * Example: 4 supporting points / 5 = 0.8 richness score
 *
 * Tuning impact: Lower to 4 to reward depth at lower point counts.
 */
const ARGUMENT_RICHNESS_POINTS = 5;

/**
 * Argument Depth Normalization
 *
 * Normalize opening argument length to 1.0 when this many characters (200) are present.
 * Used to score reasoning depth.
 *
 * Example: 180 char opening / 200 = 0.9 depth score
 *
 * Tuning impact: Lower to 150 to reward concise arguments more.
 */
const ARGUMENT_DEPTH_CHARS = 200;

// ---------------------------------------------------------------------------
// Debate History & Precision Constants
// ---------------------------------------------------------------------------

/**
 * Minimum Reasoning Length for Argument Inclusion
 *
 * Minimum characters required in an agent's reasoning text (10) to include it
 * as a supporting point in debate arguments.
 *
 * Example: "BUY" (3 chars) → excluded. "Strong earnings growth..." (30 chars) → included.
 *
 * Tuning impact: Raise to 20 to require more substantive reasoning before including.
 */
const MIN_REASONING_LENGTH_FOR_ARGUMENT = 10;

/**
 * Debate History Display Limit
 *
 * Maximum number of past debates returned by getDebateHistory() queries (50).
 * Sorted by most recent first before slicing.
 *
 * Example: 150 debates in DB → return most recent 50 for display.
 *
 * Tuning impact: Increase to 100 for longer history displays, decrease to 25
 * for faster API response times.
 */
const DEBATE_HISTORY_DISPLAY_LIMIT = 50;

/**
 * Win Rate Precision Rounding
 *
 * Produces 1-decimal-place win rate percentages (e.g., 67.3%) via:
 *   Math.round(fraction × WIN_RATE_PRECISION_MULTIPLIER) / WIN_RATE_PRECISION_DIVISOR
 *
 * Formula: Math.round((wins/total) × 1000) / 10 = 1-decimal percentage
 * Example: 67/100 → Math.round(670) / 10 = 67.0%
 *
 * Tuning impact: Change to 10000/100 for 2-decimal precision (67.00%).
 */
const WIN_RATE_PRECISION_MULTIPLIER = 1000;
const WIN_RATE_PRECISION_DIVISOR = 10;

/**
 * Average Conviction Precision Rounding
 *
 * Produces 1-decimal-place conviction averages (e.g., 73.6) via:
 *   Math.round(value × CONVICTION_PRECISION_MULTIPLIER) / CONVICTION_PRECISION_DIVISOR
 *
 * Formula: Math.round(totalConfidence/debates × 10) / 10 = 1-decimal score
 * Example: 736/10 = 73.6 average conviction score
 *
 * Tuning impact: Change to 100/100 for whole-number precision (74).
 */
const CONVICTION_PRECISION_MULTIPLIER = 10;
const CONVICTION_PRECISION_DIVISOR = 10;

/**
 * Percentage Conversion Multiplier
 *
 * Converts a decimal ratio (0.0–1.0) to an integer percentage (0–100).
 *
 * Formula: percentage = Math.round(ratio × PERCENT_MULTIPLIER)
 *
 * Examples:
 * - Bullish stance: (buyCount / total) × 100 → 67% bullish
 * - Price change:   (priceNow - priceAtDebate) / priceAtDebate × 100 → +3.2%
 * - Contrarianism:  (contrarianCount / totalRounds) × 100 → 45% contrarian
 *
 * Also used as divisor to normalize confidence (0–100) to fraction (0.0–1.0):
 *   conviction = (confidence / PERCENT_MULTIPLIER) × MAX_SCORE
 */
const PERCENT_MULTIPLIER = 100;

// ---------------------------------------------------------------------------
// Database Query Limit Constants
// ---------------------------------------------------------------------------

/**
 * Recent Decisions Per Agent for Market Outlook
 *
 * Maximum agent decisions fetched per agent when building the market outlook
 * summary (10). Covers roughly 1-2 recent trading rounds per agent.
 *
 * Example: 3 agents × 10 decisions each = 30 rows scanned for outlook symbols.
 *
 * Tuning impact: Increase to 20 for broader historical coverage in outlook.
 */
const OUTLOOK_DECISIONS_PER_AGENT = 10;

/**
 * Recent Decisions for Debate Discovery
 *
 * Maximum total decisions fetched when scanning for recent debate opportunities
 * (200). Scans across all agents and rounds to find disagreements.
 *
 * Example: 200 decisions ÷ 3 agents ÷ 3 rounds ≈ 22 decisions per round.
 *
 * Tuning impact: Increase to 300 for deeper disagreement history scanning.
 */
const DEBATE_DISCOVERY_DECISIONS_LIMIT = 200;

/**
 * Recent Decisions Per Agent for Stance Analysis
 *
 * Maximum decisions fetched per agent when computing stance classification
 * (bullish/bearish/neutral) for debate participants (20).
 *
 * Example: 20 decisions → 12 buys, 8 sells = 60% buy rate → "Strongly Bullish"
 *
 * Tuning impact: Increase to 30 for more stable stance classification.
 */
const STANCE_DECISIONS_PER_AGENT = 20;

/**
 * Decisions Fetched for Contrarianism Score Analysis
 *
 * Maximum total decisions fetched when computing an agent's contrarianism
 * score (500). Needs broad sample to find rounds where agent went against majority.
 *
 * Example: 500 decisions ÷ 3 agents ÷ 30 rounds ≈ 5-6 decisions per round.
 *
 * Tuning impact: Decrease to 300 for faster contrarianism queries.
 */
const CONTRARIANISM_DECISIONS_LIMIT = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A full structured debate between agents about a stock */
export interface Debate {
  id: string;
  symbol: string;
  stockName: string;
  currentPrice: number;
  createdAt: string;
  status: "active" | "resolved";
  topic: string;
  participants: Array<{
    agentId: string;
    agentName: string;
    provider: string;
    position: "bullish" | "bearish" | "neutral";
    action: string;
    confidence: number;
    openingArgument: string;
    supportingPoints: string[];
    rebuttal: string;
    closingStatement: string;
  }>;
  analysis: {
    consensusLevel: string;
    mostConvincing: { agentId: string; agentName: string; score: number; reason: string };
    keyDisagreements: string[];
    marketImplications: string;
  };
  judging: {
    winner: { agentId: string; agentName: string; score: number };
    scoring: Array<{
      agentId: string;
      agentName: string;
      scores: {
        conviction: number;
        reasoning: number;
        dataUsage: number;
        riskAwareness: number;
        total: number;
      };
    }>;
    verdict: string;
  };
}

/** Outlook from each agent on the overall market */
export interface MarketOutlook {
  generatedAt: string;
  overallSentiment: string;
  agentOutlooks: Array<{
    agentId: string;
    agentName: string;
    provider: string;
    stance: string;
    bullishPercentage: number;
    keyThesis: string;
    topPicks: Array<{ symbol: string; action: string; confidence: number }>;
    riskFactors: string[];
    outlook: string;
  }>;
  consensusAreas: Array<{ symbol: string; unanimousAction: string; avgConfidence: number }>;
  disagreementAreas: Array<{ symbol: string; positions: Record<string, string>; intensity: string }>;
  marketNarrative: string;
}

/** Debate performance stats for a single agent */
export interface DebateStats {
  agentId: string;
  agentName: string;
  totalDebates: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgConviction: number;
  mostDebatedSymbol: string | null;
  bestDebatePerformance: string | null;
  vsRecord: Array<{
    opponentId: string;
    opponentName: string;
    wins: number;
    losses: number;
    draws: number;
  }>;
  favoritePosition: string;
  contrarianism: number;
}

/** A debate topic — a stock where agents disagree */
interface ActiveDebateTopic {
  symbol: string;
  stockName: string;
  currentPrice: number;
  intensity: "high" | "medium" | "low";
  positions: Record<string, { action: string; confidence: number }>;
  lastActivity: string;
}

/** Internal type for a raw decision row */
type DecisionRow = {
  id: number;
  agentId: string;
  symbol: string;
  action: string;
  quantity: string;
  reasoning: string;
  confidence: number;
  modelUsed: string;
  marketSnapshot: unknown;
  executed: string | null;
  txSignature: string | null;
  executionError: string | null;
  roundId: string | null;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Agent Personality Templates (for debate argument generation)
// ---------------------------------------------------------------------------

const AGENT_ARGUMENT_TEMPLATES: Record<
  string,
  {
    bullish: { opening: string[]; points: string[][]; rebuttal: string[]; closing: string[] };
    bearish: { opening: string[]; points: string[][]; rebuttal: string[]; closing: string[] };
    neutral: { opening: string[]; points: string[][]; rebuttal: string[]; closing: string[] };
  }
> = {
  "claude-value-investor": {
    bullish: {
      opening: [
        "After careful fundamental analysis, I believe {symbol} presents a compelling value opportunity at ${price}. The market is underpricing this company's intrinsic worth.",
        "I've identified {symbol} as a classic Buffett-style investment at current levels. The fundamentals tell a story the market hasn't fully appreciated yet.",
        "The margin of safety on {symbol} at ${price} is attractive. When I look at the underlying business quality relative to the price, the math works in our favor.",
      ],
      points: [
        [
          "The current price-to-earnings ratio suggests the stock is trading below its historical average, creating a margin of safety for long-term holders.",
          "Free cash flow generation remains robust, indicating the business can fund growth organically without diluting shareholders.",
          "Management has demonstrated disciplined capital allocation — returning value through buybacks rather than empire-building acquisitions.",
          "The competitive moat is widening: switching costs, network effects, and brand equity provide durable earnings power.",
        ],
        [
          "Book value analysis shows tangible assets underpin the current valuation, limiting downside risk even in adverse scenarios.",
          "Dividend yield is at the upper end of its 5-year range, suggesting the market is pricing in excessive pessimism.",
          "The balance sheet is fortress-like — ample cash reserves and manageable debt levels mean this company can weather economic storms.",
          "Insider buying has accelerated in recent quarters, which historically correlates with undervaluation.",
        ],
      ],
      rebuttal: [
        "My fellow traders focus on short-term price action, but as Graham taught us, in the short run the market is a voting machine — in the long run, it's a weighing machine. The weight of {symbol}'s fundamentals will prevail.",
        "The momentum argument misses a critical point: price trends revert to fundamental value over time. Today's 'boring' stock is tomorrow's outperformer. Patience is the value investor's edge.",
        "To those calling this stock a 'falling knife' — I'd remind you that the best investments are often made when headlines are bleakest. Quality businesses at fair prices rarely stay cheap for long.",
      ],
      closing: [
        "In investing, the most important thing is not what you buy — it's what you pay. At ${price}, {symbol} offers a rare combination of quality and value. I'm buying with a 3-5 year time horizon, and I expect the market to eventually agree with me.",
        "Be fearful when others are greedy, and greedy when others are fearful. The crowd is fearful here, and that's exactly when disciplined value investors strike. My conviction is {confidence}%.",
        "The math is simple: a wonderful company at a fair price will compound wealth over time. {symbol} fits that criteria. My position is sized for conviction, not speculation.",
      ],
    },
    bearish: {
      opening: [
        "After thorough analysis, I cannot justify {symbol}'s current valuation at ${price}. The market is pricing in perfection, and perfection rarely lasts.",
        "As a disciplined value investor, I must acknowledge when even quality companies become overvalued. {symbol} at ${price} offers insufficient margin of safety.",
        "I'm stepping aside from {symbol} here. The risk-reward has deteriorated to the point where prudence demands caution.",
      ],
      points: [
        [
          "Valuation multiples have expanded well beyond historical norms without a commensurate improvement in fundamental business quality.",
          "Rising competitive pressures and market saturation threaten the earnings growth trajectory that the current price depends on.",
          "Capital expenditure requirements are increasing, which will pressure free cash flow margins going forward.",
          "The premium being paid for growth already assumes flawless execution over multiple years — a dangerous bet.",
        ],
        [
          "Insider selling has intensified at these levels, which is a historically reliable signal of overvaluation from those with the best information.",
          "The debt-to-equity ratio has crept higher as management leverages the balance sheet to maintain growth appearances.",
          "Analyst consensus is overwhelmingly bullish, which contrarian history tells us is often a sell signal.",
          "Return on invested capital has been declining, suggesting the easy gains from the growth phase are behind us.",
        ],
      ],
      rebuttal: [
        "Momentum traders will tell you 'the trend is your friend,' but they always forget how that phrase ends: 'until the bend at the end.' Trends born of excessive optimism end in tears.",
        "The argument that 'it's different this time' has been the most expensive sentence in investing history. Valuations always matter — they just take time to assert themselves.",
        "Yes, momentum is strong. But so was momentum in Cisco at $80, in Netflix before its 75% drawdown, in countless other momentum favorites that eventually met gravity.",
      ],
      closing: [
        "Selling isn't pessimism — it's discipline. At ${price}, {symbol} is pricing in a future that's far from guaranteed. I'd rather hold cash and wait for a better entry. My conviction to sell is {confidence}%.",
        "As Buffett says, 'Rule No. 1: Never lose money. Rule No. 2: Never forget Rule No. 1.' Protecting capital at these valuations is the prudent choice.",
        "I'll gladly revisit {symbol} if it returns to a valuation that offers margin of safety. Until then, there are better uses for our capital.",
      ],
    },
    neutral: {
      opening: [
        "{symbol} at ${price} is fairly valued by my analysis. There's no compelling case to buy aggressively or sell decisively — patience is the correct position.",
        "The value investor's greatest weapon is patience. {symbol} is neither cheap enough to buy nor expensive enough to sell. I'm comfortable holding current positions.",
        "Markets often tempt us to act when inaction is the wisest choice. {symbol} is squarely in 'watchlist' territory — interesting but not yet actionable.",
      ],
      points: [
        [
          "Current valuation sits near the midpoint of its historical range — neither screamingly cheap nor dangerously expensive.",
          "Earnings quality is acceptable but not exceptional — the business is performing competently without offering a catalyst for rerating.",
          "The macro environment introduces uncertainty that makes directional bets on individual names less compelling.",
          "Risk-reward is roughly symmetric at current levels, which argues for position maintenance rather than new deployment.",
        ],
      ],
      rebuttal: [
        "Both the bulls and bears have valid points on {symbol}, which is precisely why it's a hold. When the argument is balanced, the correct action is to wait for a decisive tilt.",
        "My fellow agents want to force a trade where none is warranted. Sometimes the highest-alpha move is no move at all.",
        "I understand the urge to 'do something,' but as Charlie Munger said, 'The big money is not in the buying and selling but in the waiting.'",
      ],
      closing: [
        "Holding is a position — an active choice that requires discipline. I'm watching {symbol} closely for a catalyst that would change the risk-reward calculus. Until then, steady hands.",
        "My conviction to hold is {confidence}%. This isn't indecision — it's calculated patience waiting for the fat pitch.",
      ],
    },
  },

  "gpt-momentum-trader": {
    bullish: {
      opening: [
        "The charts are screaming BUY on {symbol} at ${price}. Momentum is accelerating, volume is confirming, and this breakout has legs. Time to ride the wave.",
        "I'm going aggressive on {symbol} here. The price action is textbook bullish — higher highs, higher lows, expanding volume. This is what a winning setup looks like.",
        "Let's go. {symbol} is setting up for a major move and I want to be positioned before the crowd catches on. The technical setup is A+.",
      ],
      points: [
        [
          "24-hour price momentum is strongly positive, with the stock breaking above key resistance levels on increasing volume.",
          "The growth narrative is intact and accelerating — revenue growth is outpacing analyst estimates, and forward guidance has been raised.",
          "Relative strength vs the broader market (SPY) is at a 52-week high, signaling institutional rotation into this name.",
          "Options flow shows aggressive call buying, suggesting smart money is positioning for significant upside.",
        ],
        [
          "The stock just crossed above its 50-day moving average with the highest volume in 3 months — a classic breakout signal.",
          "Short interest is declining rapidly, which means the bears are capitulating and removing a headwind from the stock.",
          "Earnings whisper numbers are significantly above consensus — the setup for a beat-and-raise quarter is high.",
          "Sector rotation data shows money flowing into this space aggressively, providing a rising-tide tailwind.",
        ],
      ],
      rebuttal: [
        "Value investors will tell you to 'wait for a better entry' — but in momentum trading, waiting IS the risk. The best stocks don't wait for you. They reward the bold and punish the hesitant.",
        "The contrarian says 'everyone's too bullish.' But sometimes everyone is bullish BECAUSE the stock is going up, and it keeps going up because the fundamentals support it. Not every trend is a bubble.",
        "Sure, the P/E looks 'expensive' by traditional metrics. But legacy valuation frameworks can't capture the earnings power of companies growing revenue 30%+ annually. Growth at a reasonable price IS value.",
      ],
      closing: [
        "In momentum trading, you ride the trend until it breaks. {symbol}'s trend hasn't just held — it's accelerating. I'm going in with {confidence}% conviction and I'll cut if the 20-day MA breaks. Simple.",
        "Fortune favors the bold. {symbol} has breakout written all over it, and I'm not going to watch from the sidelines. Position on, stops set, let the market do its thing.",
        "This is the kind of setup that makes careers. Strong momentum, clean technicals, growing fundamentals. I'm buying with {confidence}% confidence and I'll ride this until the music stops.",
      ],
    },
    bearish: {
      opening: [
        "I'm cutting {symbol} here — the momentum has died and the chart pattern is breaking down. When the trend turns, you don't ask questions, you rotate.",
        "Sell signal flashing red on {symbol} at ${price}. Volume is drying up on rallies and expanding on sell-offs. The smart money is exiting and so am I.",
        "{symbol} just failed at resistance for the third time — that's a triple top, and in my book, that's the exit sign. Taking profits and moving on.",
      ],
      points: [
        [
          "Price momentum has reversed sharply — the stock is making lower highs and lower lows, the definition of a downtrend.",
          "Volume on down days is 2-3x the volume on up days, showing institutional distribution is underway.",
          "Relative strength is collapsing vs the broader market — when the tide goes out, weak names get exposed first.",
          "The 50-day moving average just crossed below the 200-day — the 'death cross' that historically precedes extended weakness.",
        ],
        [
          "Options market is pricing in significant downside via elevated put skew — the hedging activity tells you sophisticated players are worried.",
          "Revenue deceleration is accelerating — growth is slowing quarter over quarter, and the market has zero patience for decelerating growth stocks.",
          "The stock just lost its 200-day moving average on heavy volume, a level that served as support for the entire rally.",
          "Sector peers are also weakening, suggesting this isn't stock-specific but a broader rotation out of the space.",
        ],
      ],
      rebuttal: [
        "The value investor says 'it's cheaper now so it's a better buy.' But cheaper can always get cheaperer. A stock down 50% can drop another 50%. Catching falling knives is how you bleed capital.",
        "To the contrarian buying the dip — yes, sometimes dips ARE buying opportunities. But sometimes a dip is the beginning of a 40% decline. The trend tells you which one this is, and the trend says DOWN.",
        "Fundamentals don't matter if the price is in freefall. The market can stay irrational longer than your portfolio can stay solvent. Respect the tape.",
      ],
      closing: [
        "Cut your losers, let your winners run. {symbol} is a loser at ${price} and I'm cutting it with {confidence}% conviction. Capital preservation is job one.",
        "There's no trophy for buying the bottom. There IS a trophy for not losing money. I'm out of {symbol} and will re-evaluate when the trend structure turns bullish again.",
        "In momentum trading, the exit is just as important as the entry. This is my exit. {confidence}% conviction that the downside risk exceeds the upside opportunity.",
      ],
    },
    neutral: {
      opening: [
        "{symbol} is in no-man's land right now — range-bound, low volume, waiting for a catalyst. I'm sidelined until the chart gives me a directional signal.",
        "The momentum on {symbol} is... nonexistent. It's chopping sideways and burning both bulls and bears. I need a breakout or breakdown before I commit capital.",
        "I don't trade hope — I trade setups. And {symbol} at ${price} doesn't have a setup worth risking capital on right now.",
      ],
      points: [
        [
          "The stock is consolidating in a tightening range — coiling for a move, but the direction is unclear from current price action.",
          "Volume has contracted significantly, indicating neither buyers nor sellers have conviction at current levels.",
          "Key technical levels above and below are clearly defined — a break of either one will signal the next major move.",
          "Sector momentum is mixed, removing the tailwind or headwind that would help clarify direction.",
        ],
      ],
      rebuttal: [
        "The value investor wants to buy here because 'it's fairly valued.' But fair value doesn't make money — mispricing does. Until the market misprices {symbol}, I have no edge.",
        "The contrarian wants to fade the trend — but there IS no trend to fade. Both sides are forcing a narrative onto a stock that's simply going sideways.",
      ],
      closing: [
        "No trend, no trade. I'm watching {symbol} closely and will be the first to act when it breaks out. Until then, my capital is deployed in names with actual momentum. Conviction to hold: {confidence}%.",
        "Patience isn't my strong suit, but even I know better than to force trades in a choppy, directionless market. Sitting this one out at {confidence}% conviction.",
      ],
    },
  },

  "grok-contrarian": {
    bullish: {
      opening: [
        "Everyone hates {symbol} at ${price}. Good. That's exactly when I want to buy. The crowd is usually wrong at extremes, and this is an extreme.",
        "Call me crazy, but I'm buying {symbol} right here while the rest of you are running for the exits. History rewards those who buy the blood in the streets.",
        "The Wall Street herd is stampeding away from {symbol}. Which means, if you've studied any market history at all, it's probably time to buy.",
      ],
      points: [
        [
          "Sentiment indicators are at bearish extremes — retail put/call ratios, social media negativity, and analyst downgrades are all peaking. This is historically bullish.",
          "The stock is trading at a significant discount to its 52-week high, but the underlying business hasn't deteriorated proportionally to the decline.",
          "Short interest has reached levels that historically trigger violent short squeezes — the spring is coiled and loaded.",
          "Everyone's focused on the current bad news, ignoring upcoming catalysts that could reshape the narrative entirely.",
        ],
        [
          "Fund manager surveys show historic underweighting of this sector — when the rotation happens, the snap-back will be dramatic.",
          "The company is quietly executing on strategic initiatives that the market is too distracted by short-term noise to appreciate.",
          "Insider buying is happening in size at these levels — the people who know the business best are voting with their wallets, not their tweets.",
          "Comparable historical situations — similar drawdowns on similar fundamentals — have resulted in 40-80% recoveries within 12 months.",
        ],
      ],
      rebuttal: [
        "The momentum trader says 'trend is down, stay away.' But they said the same thing about Amazon at $6, Apple at $4, and Bitcoin at $3,000. Trends end. Contrarians profit.",
        "The value investor agrees on the fundamentals but wants to 'wait for a better entry.' In my experience, the perfect entry never comes — by the time all the stars align, the stock is already up 30%.",
        "Yes, the chart looks terrible. Know what else looked terrible? Every single generational buying opportunity in market history. The chart looks worst precisely when the opportunity is greatest.",
      ],
      closing: [
        "I've seen this movie before. The crowd panics, sells at the bottom, then watches in disbelief as the stock recovers everything they lost. I'm buying their panic at {confidence}% conviction.",
        "Contrarian investing isn't about being different for its own sake — it's about recognizing when the market's emotional reaction has created a price that doesn't match reality. {symbol} is that opportunity.",
        "In 12 months, we'll look back at {symbol} at ${price} the way we look back at every panic-driven selloff: as an obvious buying opportunity that most people were too scared to take.",
      ],
    },
    bearish: {
      opening: [
        "I know I'm usually the contrarian, but even I can see that {symbol} at ${price} is a consensus trade that's gotten dangerously crowded. Time to fade the herd.",
        "Everyone and their grandmother owns {symbol}. Baristas are giving stock tips about it. Magazine covers are featuring it. If that's not a sell signal, I don't know what is.",
        "The crowd is euphoric about {symbol}. And history has one lesson that never fails: when the crowd is euphoric, the exit doors are about to get very narrow.",
      ],
      points: [
        [
          "Sentiment is at euphoric extremes — bullish consensus exceeds 80%, which has historically preceded significant drawdowns.",
          "The stock has become a consensus 'must-own' among retail and institutional investors, creating a crowded long that's vulnerable to any negative catalyst.",
          "Valuation has detached from any reasonable fundamental anchor — the price is being driven by narrative, not numbers.",
          "Insiders are selling at the fastest pace in 2 years, which is the contrarian's strongest sell signal.",
        ],
        [
          "Market history shows that 'everyone knows' stocks — the ones that feel like they can't go down — are precisely the ones that eventually crater.",
          "The media narrative has shifted from cautious optimism to outright euphoria, a classic late-stage signal.",
          "Put/call ratios are at historic lows, meaning nobody is hedging, meaning the downside move when it comes will be amplified by panic.",
          "The 'greater fool' dynamics are visible: people aren't buying because of fundamentals, they're buying because they expect someone else to buy higher.",
        ],
      ],
      rebuttal: [
        "The momentum trader loves this trend. Of course they do — momentum traders love every trend right until it reverses. The question isn't whether the trend is strong, but whether it's sustainable. Spoiler: it's not.",
        "The value investor has been slowly buying, calling it 'quality at a reasonable price.' But 40x earnings is nobody's definition of reasonable except in a bubble. And we're in a bubble.",
        "Both my opponents will tell you the fundamentals justify the price. They said the same thing about every mania in history. The fundamentals always 'justify' the price — until they don't.",
      ],
      closing: [
        "When the shoeshine boy gives you stock tips, sell everything. We're past shoeshine-boy territory on {symbol}. Selling at {confidence}% conviction.",
        "I don't enjoy being bearish on popular names. But I enjoy losing money even less. {symbol} at ${price} is a contrarian sell, and I'll take the heat now to avoid the pain later.",
        "The market is not a popularity contest — or rather, it is, and you want to sell what's popular before it becomes unpopular. {symbol} is peak popular.",
      ],
    },
    neutral: {
      opening: [
        "For once, I don't have a strong contrarian view on {symbol}. The sentiment isn't extreme in either direction, which means there's no contrarian edge here.",
        "{symbol} at ${price} is sitting right in the middle of the consensus range. No panic to buy, no euphoria to sell. Even contrarians need a reason to act.",
        "I'm sitting this one out. My edge is buying what everyone hates and selling what everyone loves. {symbol} is neither — it's 'meh,' and 'meh' doesn't make money.",
      ],
      points: [
        [
          "Sentiment is balanced — neither fearful enough to buy nor greedy enough to sell. The contrarian trade here is no trade at all.",
          "The stock is trading near fair value by most reasonable frameworks, removing both the value trap and the bubble risk.",
          "Media coverage is moderate and balanced — no narrative extreme to fade or exploit.",
          "Short interest, insider activity, and fund positioning are all at neutral levels — no asymmetric setup to exploit.",
        ],
      ],
      rebuttal: [
        "The momentum trader wants to trade the range. Good luck — range-bound markets are where momentum strategies go to die, eaten alive by whipsaws and false breakouts.",
        "The value investor is comfortable holding. I respect that, but 'comfortable' rarely correlates with 'profitable.' The big money is made at the extremes.",
      ],
      closing: [
        "I'll pass on this one. My strength is identifying sentiment extremes, and {symbol} is decidedly not extreme in any direction. Holding at {confidence}% conviction — no strong view.",
        "Sometimes the most contrarian thing you can do is... nothing. When there's no crowd to fade, there's no edge. Watching and waiting.",
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Argument Generation Helpers
// ---------------------------------------------------------------------------

/** Pick a random element from an array using a seeded index */
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/** Generate a deterministic seed from a string (symbol + agentId + date) */
function hashSeed(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Interpolate template variables */
function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

/** Map an action string to a position stance */
function actionToPosition(action: string): "bullish" | "bearish" | "neutral" {
  if (action === "buy") return "bullish";
  if (action === "sell") return "bearish";
  return "neutral";
}

/** Build debate arguments for a participant from templates and real data */
function buildArguments(
  agentId: string,
  position: "bullish" | "bearish" | "neutral",
  symbol: string,
  price: number,
  confidence: number,
  reasoning: string,
  seed: number,
): { openingArgument: string; supportingPoints: string[]; rebuttal: string; closingStatement: string } {
  const templates = AGENT_ARGUMENT_TEMPLATES[agentId];

  // Fallback if agent not found in templates
  if (!templates) {
    return {
      openingArgument: `Based on my analysis, I'm ${position} on ${symbol} at $${price}. ${reasoning}`,
      supportingPoints: [reasoning],
      rebuttal: `I stand by my ${position} thesis. The data supports my position with ${confidence}% confidence.`,
      closingStatement: `My conviction is ${confidence}%. I believe time will prove this ${position} call correct.`,
    };
  }

  const positionTemplates = templates[position];
  const vars = { symbol, price, confidence, reasoning };

  const openingArgument = interpolate(pick(positionTemplates.opening, seed), vars);
  const pointSet = pick(positionTemplates.points, seed + 1);
  const supportingPoints = pointSet.map((p) => interpolate(p, vars));

  // Append the agent's actual reasoning as the final supporting point
  if (reasoning && reasoning.length > MIN_REASONING_LENGTH_FOR_ARGUMENT) {
    supportingPoints.push(`My specific analysis: ${reasoning}`);
  }

  const rebuttal = interpolate(pick(positionTemplates.rebuttal, seed + 2), vars);
  const closingStatement = interpolate(pick(positionTemplates.closing, seed + 3), vars);

  return { openingArgument, supportingPoints, rebuttal, closingStatement };
}

// ---------------------------------------------------------------------------
// Scoring Engine
// ---------------------------------------------------------------------------

/** Score an agent's debate performance on 4 dimensions (0-25 each, total 0-100) */
function scoreParticipant(
  participant: Debate["participants"][0],
  allParticipants: Debate["participants"],
): { conviction: number; reasoning: number; dataUsage: number; riskAwareness: number; total: number } {
  // Conviction: based on confidence and strength of position
  const conviction = Math.min(DEBATE_SCORE_MAX_PER_DIMENSION, Math.round((participant.confidence / PERCENT_MULTIPLIER) * DEBATE_SCORE_MAX_PER_DIMENSION));

  // Reasoning: based on number of supporting points and argument length
  const argumentRichness = Math.min(1, participant.supportingPoints.length / ARGUMENT_RICHNESS_POINTS);
  const argumentDepth = Math.min(1, participant.openingArgument.length / ARGUMENT_DEPTH_CHARS);
  const reasoning = Math.min(DEBATE_SCORE_MAX_PER_DIMENSION, Math.round(((argumentRichness + argumentDepth) / 2) * DEBATE_SCORE_MAX_PER_DIMENSION));

  // Data Usage: agents that cite specific metrics score higher
  const dataKeywords = ["ratio", "volume", "growth", "earnings", "cash flow", "margin", "moving average", "%", "revenue", "insider"];
  const allText = [participant.openingArgument, ...participant.supportingPoints, participant.rebuttal].join(" ").toLowerCase();
  const dataHits = countByCondition(dataKeywords, (kw) => allText.includes(kw));
  const dataUsage = Math.min(DEBATE_SCORE_MAX_PER_DIMENSION, Math.round((dataHits / dataKeywords.length) * DEBATE_SCORE_MAX_PER_DIMENSION));

  // Risk Awareness: agents that acknowledge risk or opposing views score higher
  const riskKeywords = ["risk", "downside", "caution", "however", "although", "despite", "but", "careful", "safety", "protect"];
  const riskHits = countByCondition(riskKeywords, (kw) => allText.includes(kw));
  const riskAwareness = Math.min(DEBATE_SCORE_MAX_PER_DIMENSION, Math.round((riskHits / riskKeywords.length) * DEBATE_SCORE_MAX_PER_DIMENSION));

  const total = conviction + reasoning + dataUsage + riskAwareness;

  return { conviction, reasoning, dataUsage, riskAwareness, total };
}

// ---------------------------------------------------------------------------
// Core Exported Functions
// ---------------------------------------------------------------------------

/**
 * Generate a structured debate about a specific stock.
 *
 * Finds each agent's latest position on the symbol, builds arguments from
 * their reasoning and personality templates, scores each participant, and
 * determines a winner.
 *
 * @param symbol - Stock symbol to debate (e.g., "NVDAx")
 * @returns Full debate transcript, or null if insufficient data
 */
export async function generateDebate(symbol: string): Promise<Debate | null> {
  const configs = getAgentConfigs();

  // Fetch market data for the stock
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }
  const stock = marketData.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
  const currentPrice = stock?.price ?? 0;
  const stockName = stock?.name ?? symbol;

  // Fetch each agent's latest decision on this symbol
  const participants: Debate["participants"] = [];

  for (const config of configs) {
    const latestDecisions = await db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.agentId, config.agentId), eq(agentDecisions.symbol, symbol)))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(1);

    const decision = latestDecisions[0];
    if (!decision) continue;

    const position = actionToPosition(decision.action);
    const seed = hashSeed(`${symbol}_${config.agentId}_${decision.createdAt.toISOString().slice(0, 10)}`);
    const args = buildArguments(
      config.agentId,
      position,
      symbol,
      currentPrice,
      decision.confidence,
      decision.reasoning,
      seed,
    );

    participants.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      position,
      action: decision.action,
      confidence: decision.confidence,
      ...args,
    });
  }

  // Need at least MIN_AGENTS_FOR_DEBATE participants for a meaningful debate
  if (participants.length < MIN_AGENTS_FOR_DEBATE) return null;

  // Score each participant
  const scoring = participants.map((p) => ({
    agentId: p.agentId,
    agentName: p.agentName,
    scores: scoreParticipant(p, participants),
  }));

  // Determine winner (highest total score)
  const sorted = [...scoring].sort((a, b) => b.scores.total - a.scores.total);
  const winner = sorted[0];

  // Determine consensus level
  const positions = new Set(participants.map((p) => p.position));
  let consensusLevel: string;
  if (positions.size === 1) {
    consensusLevel = "Full consensus — all agents agree";
  } else if (positions.size === 2) {
    consensusLevel = "Partial disagreement — agents split on direction";
  } else {
    consensusLevel = "Complete divergence — all agents hold different views";
  }

  // Key disagreements
  const keyDisagreements: string[] = [];
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i];
      const b = participants[j];
      if (a.position !== b.position) {
        keyDisagreements.push(
          `${a.agentName} (${a.position}) vs ${b.agentName} (${b.position}): ${Math.abs(a.confidence - b.confidence)} point confidence gap`,
        );
      }
    }
  }

  // Market implications
  const bullishCount = countByCondition(participants, (p) => p.position === "bullish");
  const bearishCount = countByCondition(participants, (p) => p.position === "bearish");
  let marketImplications: string;
  if (bullishCount > bearishCount) {
    marketImplications = `Majority bullish sentiment from AI agents suggests potential upside for ${symbol}. However, dissenting views highlight risks that investors should monitor.`;
  } else if (bearishCount > bullishCount) {
    marketImplications = `Majority bearish sentiment from AI agents signals caution on ${symbol}. The bull case exists but faces significant headwinds identified by the majority.`;
  } else {
    marketImplications = `Evenly split sentiment on ${symbol} indicates a stock at an inflection point. Watch for a catalyst to break the deadlock and establish directional conviction.`;
  }

  // Most convincing participant (winner with reason)
  const winnerParticipant = participants.find((p) => p.agentId === winner.agentId)!;
  const mostConvincing = {
    agentId: winner.agentId,
    agentName: winner.agentName,
    score: winner.scores.total,
    reason: `${winner.agentName} presented the strongest case with ${winner.scores.total}/100 overall score — excelling in ${
      winner.scores.conviction >= winner.scores.reasoning && winner.scores.conviction >= winner.scores.dataUsage
        ? "conviction"
        : winner.scores.reasoning >= winner.scores.dataUsage
          ? "quality of reasoning"
          : "data-driven analysis"
    } (${winnerParticipant.position} at ${winnerParticipant.confidence}% confidence).`,
  };

  // Build verdict narrative
  const runnerUp = sorted[1];
  const scoreDiff = winner.scores.total - runnerUp.scores.total;
  let verdict: string;
  if (scoreDiff > DEBATE_DECISIVE_MARGIN) {
    verdict = `Decisive victory for ${winner.agentName}. With a ${scoreDiff}-point margin over ${runnerUp.agentName}, the ${winnerParticipant.position} case was clearly stronger — backed by deeper analysis, higher conviction, and better risk awareness.`;
  } else if (scoreDiff > DEBATE_CLOSE_MARGIN) {
    verdict = `${winner.agentName} edges out ${runnerUp.agentName} by ${scoreDiff} points. Both made compelling arguments, but ${winner.agentName}'s ${winnerParticipant.position} thesis was more thoroughly supported and demonstrated stronger conviction.`;
  } else {
    verdict = `A razor-thin margin separates ${winner.agentName} and ${runnerUp.agentName} — just ${scoreDiff} points. This debate is essentially a draw, reflecting genuine uncertainty about ${symbol}'s direction. Both positions have merit.`;
  }

  const debateId = `debate_${symbol}_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;

  return {
    id: debateId,
    symbol,
    stockName,
    currentPrice,
    createdAt: new Date().toISOString(),
    status: positions.size === 1 ? "resolved" : "active",
    topic: `Should you ${bullishCount >= bearishCount ? "buy" : "sell"} ${symbol} at $${currentPrice.toFixed(2)}?`,
    participants,
    analysis: {
      consensusLevel,
      mostConvincing,
      keyDisagreements,
      marketImplications,
    },
    judging: {
      winner: { agentId: winner.agentId, agentName: winner.agentName, score: winner.scores.total },
      scoring,
      verdict,
    },
  };
}

/**
 * Get all stocks where agents currently disagree — the active debate topics.
 *
 * Finds symbols where agents have different recent actions, ranks them by
 * disagreement intensity (buy vs sell = high, buy/sell vs hold = medium),
 * and returns a list of active debate topics.
 *
 * @returns List of active debate topics sorted by intensity
 */
export async function getActiveDebates(): Promise<ActiveDebateTopic[]> {
  const configs = getAgentConfigs();
  const symbolMap = new Map<string, Map<string, { action: string; confidence: number; createdAt: Date }>>();

  // Fetch each agent's most recent decisions (last 10 per agent)
  for (const config of configs) {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, config.agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(OUTLOOK_DECISIONS_PER_AGENT);

    // Track latest decision per symbol for this agent
    const seenSymbols = new Set<string>();
    for (const d of decisions) {
      if (seenSymbols.has(d.symbol)) continue;
      seenSymbols.add(d.symbol);

      if (!symbolMap.has(d.symbol)) {
        symbolMap.set(d.symbol, new Map());
      }
      symbolMap.get(d.symbol)!.set(config.agentId, {
        action: d.action,
        confidence: d.confidence,
        createdAt: d.createdAt,
      });
    }
  }

  const topics: ActiveDebateTopic[] = [];
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  for (const [symbol, agentPositions] of symbolMap) {
    if (agentPositions.size < 2) continue;

    const actions = new Set(Array.from(agentPositions.values()).map((v) => v.action));
    if (actions.size < 2) continue; // All agents agree — no debate

    // Determine intensity
    const hasBuy = actions.has("buy");
    const hasSell = actions.has("sell");
    let intensity: "high" | "medium" | "low";
    if (hasBuy && hasSell) {
      intensity = "high";
    } else if ((hasBuy || hasSell) && actions.has("hold")) {
      intensity = "medium";
    } else {
      intensity = "low";
    }

    const stock = marketData.find((m) => m.symbol === symbol);
    const positions: Record<string, { action: string; confidence: number }> = {};
    let lastActivity = new Date(0);

    for (const [agentId, data] of agentPositions) {
      positions[agentId] = { action: data.action, confidence: data.confidence };
      if (data.createdAt > lastActivity) {
        lastActivity = data.createdAt;
      }
    }

    topics.push({
      symbol,
      stockName: stock?.name ?? symbol,
      currentPrice: stock?.price ?? 0,
      intensity,
      positions,
      lastActivity: lastActivity.toISOString(),
    });
  }

  // Sort by intensity (high first) then by recency
  const intensityOrder = { high: 0, medium: 1, low: 2 };
  topics.sort((a, b) => {
    const intensityDiff = intensityOrder[a.intensity] - intensityOrder[b.intensity];
    if (intensityDiff !== 0) return intensityDiff;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  return topics;
}

/**
 * Get historical debate outcomes with accuracy tracking.
 *
 * For each past debate (symbol where agents disagreed), checks whether the
 * price subsequently moved in the direction of the winning agent's position.
 * Tracks win/loss records per agent.
 *
 * @returns Array of past debate outcomes with resolution data
 */
export async function getDebateHistory(): Promise<
  Array<{
    symbol: string;
    debateDate: string;
    participants: Array<{ agentId: string; agentName: string; position: string; confidence: number }>;
    winner: { agentId: string; agentName: string } | null;
    priceAtDebate: number;
    priceNow: number;
    priceChange: number;
    correctAgent: { agentId: string; agentName: string } | null;
    resolved: boolean;
  }>
> {
  const configs = getAgentConfigs();
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  // Fetch all decisions grouped by roundId to find debates
  const allDecisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(DEBATE_DISCOVERY_DECISIONS_LIMIT);

  // Group by roundId to find rounds where agents disagreed
  const roundMap = new Map<string, DecisionRow[]>();
  for (const d of allDecisions) {
    const key = d.roundId ?? `solo_${d.id}`;
    const arr = roundMap.get(key) ?? [];
    arr.push(d as DecisionRow);
    roundMap.set(key, arr);
  }

  const history: Array<{
    symbol: string;
    debateDate: string;
    participants: Array<{ agentId: string; agentName: string; position: string; confidence: number }>;
    winner: { agentId: string; agentName: string } | null;
    priceAtDebate: number;
    priceNow: number;
    priceChange: number;
    correctAgent: { agentId: string; agentName: string } | null;
    resolved: boolean;
  }> = [];

  for (const [, roundDecisions] of roundMap) {
    if (roundDecisions.length < 2) continue;

    // Check if agents disagreed in this round
    const actions = new Set(roundDecisions.map((d) => d.action));
    if (actions.size < 2) continue;

    // Use the first decision's symbol and time as the debate context
    const primarySymbol = roundDecisions[0].symbol;
    const debateDate = roundDecisions[0].createdAt.toISOString();

    // Extract price at debate time from market snapshot
    let priceAtDebate = 0;
    for (const d of roundDecisions) {
      const snapshot = d.marketSnapshot as Record<string, { price: number }> | null;
      if (snapshot?.[primarySymbol]?.price) {
        priceAtDebate = snapshot[primarySymbol].price;
        break;
      }
    }

    // Current price
    const currentStock = marketData.find((m) => m.symbol === primarySymbol);
    const priceNow = currentStock?.price ?? priceAtDebate;
    const priceChange = priceAtDebate > 0 ? ((priceNow - priceAtDebate) / priceAtDebate) * PERCENT_MULTIPLIER : 0;

    // Build participants
    const participants = roundDecisions.map((d) => {
      const config = configs.find((c) => c.agentId === d.agentId);
      return {
        agentId: d.agentId,
        agentName: config?.name ?? d.agentId,
        position: actionToPosition(d.action),
        confidence: d.confidence,
      };
    });

    // Determine who was "right" — did the price move in their predicted direction?
    let correctAgent: { agentId: string; agentName: string } | null = null;
    const resolved = Math.abs(priceChange) > PRICE_RESOLUTION_THRESHOLD; // Need at least PRICE_RESOLUTION_THRESHOLD% move to call it resolved

    if (resolved) {
      const priceWentUp = priceChange > 0;
      for (const p of participants) {
        if ((p.position === "bullish" && priceWentUp) || (p.position === "bearish" && !priceWentUp)) {
          correctAgent = { agentId: p.agentId, agentName: p.agentName };
          break; // First matching agent by confidence (sorted by confidence below)
        }
      }
    }

    // Simple winner determination by confidence
    const sortedByConf = [...participants].sort((a, b) => b.confidence - a.confidence);
    const winner = sortedByConf[0]
      ? { agentId: sortedByConf[0].agentId, agentName: sortedByConf[0].agentName }
      : null;

    history.push({
      symbol: primarySymbol,
      debateDate,
      participants,
      winner,
      priceAtDebate,
      priceNow,
      priceChange: round2(priceChange),
      correctAgent,
      resolved,
    });
  }

  // Sort by date (most recent first), limit to 50
  history.sort((a, b) => new Date(b.debateDate).getTime() - new Date(a.debateDate).getTime());
  return history.slice(0, DEBATE_HISTORY_DISPLAY_LIMIT);
}

/**
 * Generate a comprehensive market outlook from each agent's perspective.
 *
 * Aggregates recent decisions into bullish/bearish/neutral stance per agent,
 * generates structured outlooks, and identifies areas of agreement and
 * disagreement across the agent roster.
 *
 * @returns Full market outlook with each agent's view and consensus analysis
 */
export async function generateMarketOutlook(): Promise<MarketOutlook> {
  const configs = getAgentConfigs();
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  const agentOutlooks: MarketOutlook["agentOutlooks"] = [];

  // Per-agent symbol->action map for consensus calculation
  const agentSymbolActions = new Map<string, Map<string, string>>();

  for (const config of configs) {
    // Fetch recent decisions for this agent
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, config.agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(STANCE_DECISIONS_PER_AGENT);

    if (decisions.length === 0) continue;

    // Aggregate stance
    const buyCount = countByCondition(decisions, (d: DecisionRow) => d.action === "buy");
    const sellCount = countByCondition(decisions, (d: DecisionRow) => d.action === "sell");
    const holdCount = countByCondition(decisions, (d: DecisionRow) => d.action === "hold");
    const total = decisions.length;

    const bullishPct = Math.round((buyCount / total) * PERCENT_MULTIPLIER);
    const bearishPct = Math.round((sellCount / total) * PERCENT_MULTIPLIER);

    let stance: string;
    if (bullishPct > STANCE_STRONG_THRESHOLD) stance = "Strongly Bullish";
    else if (bullishPct > STANCE_MODERATE_THRESHOLD) stance = "Moderately Bullish";
    else if (bearishPct > STANCE_STRONG_THRESHOLD) stance = "Strongly Bearish";
    else if (bearishPct > STANCE_MODERATE_THRESHOLD) stance = "Moderately Bearish";
    else stance = "Neutral / Mixed";

    // Top picks (unique symbols, highest confidence first)
    const symbolBest = new Map<string, { action: string; confidence: number }>();
    for (const d of decisions) {
      if (d.action === "hold") continue;
      if (!symbolBest.has(d.symbol) || d.confidence > symbolBest.get(d.symbol)!.confidence) {
        symbolBest.set(d.symbol, { action: d.action, confidence: d.confidence });
      }
    }
    const topPicks = Array.from(symbolBest.entries())
      .sort(([, a], [, b]) => b.confidence - a.confidence)
      .slice(0, TOP_PICKS_DISPLAY_LIMIT)
      .map(([sym, data]) => ({ symbol: sym, action: data.action, confidence: data.confidence }));

    // Build per-agent symbol->action for consensus
    const symbolActionMap = new Map<string, string>();
    const seenSymbols = new Set<string>();
    for (const d of decisions) {
      if (!seenSymbols.has(d.symbol)) {
        seenSymbols.add(d.symbol);
        symbolActionMap.set(d.symbol, d.action);
      }
    }
    agentSymbolActions.set(config.agentId, symbolActionMap);

    // Generate personality-appropriate outlook text
    const keyThesis = generateKeyThesis(config.agentId, stance, topPicks, decisions);
    const riskFactors = generateRiskFactors(config.agentId, stance);
    const outlook = generateOutlookNarrative(config.agentId, stance, bullishPct);

    agentOutlooks.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      stance,
      bullishPercentage: bullishPct,
      keyThesis,
      topPicks,
      riskFactors,
      outlook,
    });
  }

  // Find consensus and disagreement areas
  const allSymbols = new Set<string>();
  for (const [, map] of agentSymbolActions) {
    for (const sym of map.keys()) {
      allSymbols.add(sym);
    }
  }

  const consensusAreas: MarketOutlook["consensusAreas"] = [];
  const disagreementAreas: MarketOutlook["disagreementAreas"] = [];

  for (const symbol of allSymbols) {
    const positions: Record<string, string> = {};
    const confidences: number[] = [];

    for (const config of configs) {
      const action = agentSymbolActions.get(config.agentId)?.get(symbol);
      if (action) {
        positions[config.agentId] = action;
      }
    }

    const uniqueActions = new Set(Object.values(positions));
    const agentCount = Object.keys(positions).length;

    if (agentCount < MIN_AGENTS_FOR_CONSENSUS) continue;

    if (uniqueActions.size === 1) {
      // Consensus
      const unanimousAction = Array.from(uniqueActions)[0];
      consensusAreas.push({
        symbol,
        unanimousAction,
        avgConfidence: 0, // Will be filled below
      });
    } else {
      // Disagreement
      const hasBuy = Object.values(positions).includes("buy");
      const hasSell = Object.values(positions).includes("sell");
      const intensity = hasBuy && hasSell ? "high" : "medium";
      disagreementAreas.push({ symbol, positions, intensity });
    }
  }

  // Sort consensus by confidence, disagreements by intensity
  disagreementAreas.sort((a, b) => (a.intensity === "high" ? -1 : 1));

  // Overall sentiment
  const totalBullish = agentOutlooks.reduce((sum, o) => sum + o.bullishPercentage, 0);
  const avgBullish = agentOutlooks.length > 0 ? totalBullish / agentOutlooks.length : 50;
  let overallSentiment: string;
  if (avgBullish > SENTIMENT_BULLISH_THRESHOLD) overallSentiment = "Bullish";
  else if (avgBullish < SENTIMENT_BEARISH_THRESHOLD) overallSentiment = "Bearish";
  else overallSentiment = "Mixed / Uncertain";

  // Market narrative
  const marketNarrative = buildMarketNarrative(
    overallSentiment,
    agentOutlooks,
    consensusAreas,
    disagreementAreas,
  );

  return {
    generatedAt: new Date().toISOString(),
    overallSentiment,
    agentOutlooks,
    consensusAreas,
    disagreementAreas,
    marketNarrative,
  };
}

/**
 * Get debate performance statistics for a specific agent.
 *
 * Analyzes how often the agent is correct when disagreeing with others,
 * their average conviction when debating, most debated symbols, and
 * win/loss record vs each opponent.
 *
 * @param agentId - Agent identifier (e.g., "claude-value-investor")
 * @returns Comprehensive debate stats, or null if agent not found
 */
export async function getAgentDebateStats(agentId: string): Promise<DebateStats | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  const configs = getAgentConfigs();

  // Fetch all decisions for analysis
  const allDecisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(CONTRARIANISM_DECISIONS_LIMIT);

  const agentDecisionsList = allDecisions.filter((d: DecisionRow) => d.agentId === agentId);

  // Group all decisions by roundId
  const roundMap = new Map<string, DecisionRow[]>();
  for (const d of allDecisions) {
    const key = d.roundId ?? `solo_${d.id}`;
    const arr = roundMap.get(key) ?? [];
    arr.push(d as DecisionRow);
    roundMap.set(key, arr);
  }

  // Find rounds where this agent participated and disagreed with others
  let totalDebates = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalDebateConfidence = 0;
  const debateSymbols: Record<string, number> = {};
  const vsRecordMap = new Map<string, { wins: number; losses: number; draws: number }>();

  // Initialize vs record for all other agents
  for (const c of configs) {
    if (c.agentId !== agentId) {
      vsRecordMap.set(c.agentId, { wins: 0, losses: 0, draws: 0 });
    }
  }

  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  for (const [, roundDecisions] of roundMap) {
    const agentDecision = roundDecisions.find((d) => d.agentId === agentId);
    if (!agentDecision) continue;
    if (roundDecisions.length < 2) continue;

    const otherDecisions = roundDecisions.filter((d) => d.agentId !== agentId);
    const agentAction = agentDecision.action;

    // Check if there's a disagreement
    const hasDisagreement = otherDecisions.some((d) => d.action !== agentAction);
    if (!hasDisagreement) continue;

    totalDebates++;
    totalDebateConfidence += agentDecision.confidence;
    debateSymbols[agentDecision.symbol] = (debateSymbols[agentDecision.symbol] || 0) + 1;

    // Determine outcome: did price move in agent's predicted direction?
    const snapshot = agentDecision.marketSnapshot as Record<string, { price: number }> | null;
    const priceAtDebate = snapshot?.[agentDecision.symbol]?.price ?? 0;
    const currentStock = marketData.find((m) => m.symbol === agentDecision.symbol);
    const priceNow = currentStock?.price ?? priceAtDebate;
    const priceChange = priceAtDebate > 0 ? ((priceNow - priceAtDebate) / priceAtDebate) * PERCENT_MULTIPLIER : 0;

    const agentWasRight =
      (agentAction === "buy" && priceChange > PRICE_RESOLUTION_THRESHOLD) ||
      (agentAction === "sell" && priceChange < -PRICE_RESOLUTION_THRESHOLD);
    const agentWasWrong =
      (agentAction === "buy" && priceChange < -PRICE_RESOLUTION_THRESHOLD) ||
      (agentAction === "sell" && priceChange > PRICE_RESOLUTION_THRESHOLD);

    if (agentWasRight) {
      wins++;
    } else if (agentWasWrong) {
      losses++;
    } else {
      draws++;
    }

    // Update vs records
    for (const other of otherDecisions) {
      if (other.action === agentAction) continue; // Not a debate if they agree
      const record = vsRecordMap.get(other.agentId);
      if (!record) continue;

      if (agentWasRight) record.wins++;
      else if (agentWasWrong) record.losses++;
      else record.draws++;
    }
  }

  // Most debated symbol
  const sortedSymbols = sortEntriesDescending(debateSymbols);
  const mostDebatedSymbol = sortedSymbols[0]?.[0] ?? null;

  // Favorite position
  const buyCount = countByCondition(agentDecisionsList, (d: DecisionRow) => d.action === "buy");
  const sellCount = countByCondition(agentDecisionsList, (d: DecisionRow) => d.action === "sell");
  const holdCount = countByCondition(agentDecisionsList, (d: DecisionRow) => d.action === "hold");
  const favoritePosition = buyCount >= sellCount && buyCount >= holdCount
    ? "bullish"
    : sellCount >= holdCount
      ? "bearish"
      : "neutral";

  // Contrarianism: how often does this agent disagree with majority
  let contrarianCount = 0;
  let totalRoundsWithMajority = 0;
  for (const [, roundDecisions] of roundMap) {
    const agentDec = roundDecisions.find((d) => d.agentId === agentId);
    if (!agentDec || roundDecisions.length < MIN_AGENTS_FOR_MAJORITY) continue;

    const others = roundDecisions.filter((d) => d.agentId !== agentId);
    const otherActions = others.map((d) => d.action);
    const majorityAction = otherActions.reduce(
      (acc, action) => {
        acc[action] = (acc[action] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const topAction = getTopKey(majorityAction);

    if (topAction) {
      totalRoundsWithMajority++;
      if (agentDec.action !== topAction) contrarianCount++;
    }
  }
  const contrarianism = totalRoundsWithMajority > 0
    ? Math.round((contrarianCount / totalRoundsWithMajority) * PERCENT_MULTIPLIER)
    : 0;

  // Best debate performance
  let bestDebatePerformance: string | null = null;
  if (mostDebatedSymbol && wins > 0) {
    bestDebatePerformance = `Won ${wins} debate(s) on ${mostDebatedSymbol} with an average conviction of ${
      totalDebates > 0 ? Math.round(totalDebateConfidence / totalDebates) : 0
    }%`;
  }

  // Build vs record array
  const vsRecord = Array.from(vsRecordMap.entries()).map(([oppId, record]) => {
    const oppConfig = configs.find((c) => c.agentId === oppId);
    return {
      opponentId: oppId,
      opponentName: oppConfig?.name ?? oppId,
      wins: record.wins,
      losses: record.losses,
      draws: record.draws,
    };
  });

  const winRate = totalDebates > 0 ? Math.round((wins / totalDebates) * WIN_RATE_PRECISION_MULTIPLIER) / WIN_RATE_PRECISION_DIVISOR : 0;
  const avgConviction = totalDebates > 0 ? Math.round((totalDebateConfidence / totalDebates) * CONVICTION_PRECISION_MULTIPLIER) / CONVICTION_PRECISION_DIVISOR : 0;

  return {
    agentId,
    agentName: config.name,
    totalDebates,
    wins,
    losses,
    draws,
    winRate,
    avgConviction,
    mostDebatedSymbol,
    bestDebatePerformance,
    vsRecord,
    favoritePosition,
    contrarianism,
  };
}

// ---------------------------------------------------------------------------
// Market Outlook Narrative Generators
// ---------------------------------------------------------------------------

/** Generate a key thesis string appropriate to each agent's personality */
function generateKeyThesis(
  agentId: string,
  stance: string,
  topPicks: Array<{ symbol: string; action: string; confidence: number }>,
  decisions: Array<{ action: string; symbol: string; confidence: number }>,
): string {
  const topSymbol = topPicks[0]?.symbol ?? "the market";
  const avgConf = decisions.length > 0
    ? Math.round(decisions.reduce((s, d) => s + d.confidence, 0) / decisions.length)
    : 50;

  switch (agentId) {
    case "claude-value-investor":
      if (stance.includes("Bullish")) {
        return `Quality businesses are trading at attractive valuations. Select large-cap names like ${topSymbol} offer margin of safety with fundamentals supporting long-term appreciation. Patience and discipline remain the key to compounding wealth.`;
      } else if (stance.includes("Bearish")) {
        return `Valuations across the market are stretched beyond what fundamentals can support. Capital preservation is paramount — I'm raising cash and waiting for better entry points that offer genuine margin of safety.`;
      }
      return `The market is fairly valued with pockets of opportunity and risk. Selective deployment into quality names at reasonable prices while maintaining cash reserves for future volatility.`;

    case "gpt-momentum-trader":
      if (stance.includes("Bullish")) {
        return `Momentum is surging across multiple sectors. Price action confirms the uptrend with expanding volume and bullish technical breakouts. Names like ${topSymbol} are leading the charge — ride the trend until it bends.`;
      } else if (stance.includes("Bearish")) {
        return `Momentum has shifted decisively to the downside. Technical breakdowns across key names signal it's time to get defensive. Cutting losers fast and rotating to cash until the tape improves.`;
      }
      return `The market is range-bound and directionless. No clear momentum signal means no clear trade. Sitting tight with reduced position sizes until a breakout or breakdown provides the next setup.`;

    case "grok-contrarian":
      if (stance.includes("Bullish")) {
        return `Fear has created opportunity. The crowd is panicking over headlines while ignoring that businesses like ${topSymbol} continue to execute. History shows that buying during peak pessimism delivers outsized returns.`;
      } else if (stance.includes("Bearish")) {
        return `Euphoria has reached dangerous levels. When everyone is bullish and nobody is hedging, the setup for a correction is near-perfect. I'm fading the consensus and preparing for a reset.`;
      }
      return `Sentiment is balanced — neither fearful nor greedy. Without an extreme to exploit, the contrarian edge is muted. Maintaining current positions while watching for the next sentiment dislocation.`;

    default:
      return `Market conditions suggest a ${stance.toLowerCase()} posture with average conviction at ${avgConf}%.`;
  }
}

/** Generate risk factors appropriate to each agent's perspective */
function generateRiskFactors(agentId: string, stance: string): string[] {
  switch (agentId) {
    case "claude-value-investor":
      return [
        "Multiple expansion could reverse if interest rates rise further",
        "Earnings quality may deteriorate in a slowing economy",
        "Geopolitical risks remain elevated and could trigger risk-off sentiment",
        "Concentration risk in mega-cap technology names",
      ];
    case "gpt-momentum-trader":
      return [
        "Trend reversal could trigger cascading stop-losses",
        "Volume divergences suggest weakening conviction in current moves",
        "Sector rotation could quickly shift winners to losers",
        "Black swan events would invalidate all technical setups",
      ];
    case "grok-contrarian":
      return [
        "Consensus positioning could be correct for longer than expected",
        "Contrarian setups require patience — early entry can mean painful drawdowns",
        "Sentiment extremes can always get more extreme before reverting",
        "Narrative shifts can take quarters to play out, testing conviction",
      ];
    default:
      return ["Market volatility", "Economic uncertainty", "Interest rate risk"];
  }
}

/** Generate a personality-appropriate outlook narrative */
function generateOutlookNarrative(agentId: string, stance: string, bullishPct: number): string {
  switch (agentId) {
    case "claude-value-investor":
      if (bullishPct > STANCE_STRONG_THRESHOLD) {
        return "I see several compelling value opportunities in this market. Quality companies are available at prices that offer genuine margin of safety. My approach remains disciplined: buy wonderful businesses at fair prices and let compounding work its magic. I'm deploying capital methodically, not chasing momentum.";
      } else if (bullishPct < STANCE_MODERATE_THRESHOLD) {
        return "Prudence demands patience here. Valuations are stretched across much of the market, and the risk-reward for new positions is unfavorable. I'm content to hold elevated cash reserves and wait. The best buying opportunities emerge from periods of pessimism, and I suspect that opportunity is approaching.";
      }
      return "The market presents a balanced picture. Neither euphoric nor panicked, current conditions call for selective stock-picking rather than broad directional bets. I'm maintaining core positions in quality names while keeping powder dry for any dislocations.";

    case "gpt-momentum-trader":
      if (bullishPct > STANCE_STRONG_THRESHOLD) {
        return "The tape is bullish and I'm positioned accordingly. Multiple names are breaking out with volume confirmation, and the path of least resistance is higher. I'm running concentrated positions in the strongest momentum names and will ride them until the moving averages break. Let's make some money.";
      } else if (bullishPct < STANCE_MODERATE_THRESHOLD) {
        return "The chart damage is real and I'm not fighting the tape. When momentum is against you, the only play is defense — cut losers, raise cash, wait for the next setup. I've rotated to a defensive posture and I'll flip bullish the moment the technicals confirm a trend change.";
      }
      return "Choppy, range-bound action means reduced position sizing and quick trigger fingers. I'm trading both sides — buying dips to support, selling rips to resistance — but keeping positions small. Waiting for a decisive break in either direction.";

    case "grok-contrarian":
      if (bullishPct > STANCE_STRONG_THRESHOLD) {
        return "I'm finding compelling contrarian buys in the current environment. Several names have been beaten down well past what fundamentals justify, creating the kind of sentiment-driven mispricings that I live for. The crowd is focused on the rearview mirror — I'm looking through the windshield.";
      } else if (bullishPct < STANCE_MODERATE_THRESHOLD) {
        return "The consensus is dangerously one-sided. Everyone is bullish, nobody is hedging, and the financial media is running victory laps. This is textbook late-cycle behavior and I'm positioned for the inevitable correction. When the crowd is this comfortable, something uncomfortable usually follows.";
      }
      return "For once, I don't have a strong contrarian signal. Sentiment is balanced, which means there's no crowd to fade. I'm maintaining positions and watching for the next extreme — it's coming, it always does. The question is whether it'll be a panic (buy signal) or euphoria (sell signal).";

    default:
      return `My current outlook is ${stance.toLowerCase()} with a ${bullishPct}% bullish tilt across recent decisions.`;
  }
}

/** Build the overall market narrative from all agent outlooks */
function buildMarketNarrative(
  overallSentiment: string,
  agentOutlooks: MarketOutlook["agentOutlooks"],
  consensusAreas: MarketOutlook["consensusAreas"],
  disagreementAreas: MarketOutlook["disagreementAreas"],
): string {
  const agentSummaries = agentOutlooks
    .map((o) => `${o.agentName} (${o.provider}) is ${o.stance.toLowerCase()}`)
    .join(", ");

  const consensusCount = consensusAreas.length;
  const disagreeCount = disagreementAreas.length;
  const highIntensityCount = countByCondition(disagreementAreas, (d) => d.intensity === "high");

  let narrative = `The MoltApp AI trading arena is currently signaling ${overallSentiment.toLowerCase()} conditions. `;
  narrative += `Across our three competing agents: ${agentSummaries}. `;

  if (consensusCount > 0) {
    narrative += `The agents agree on ${consensusCount} stock(s), suggesting strong conviction in those positions. `;
  }

  if (disagreeCount > 0) {
    narrative += `However, ${disagreeCount} stock(s) remain hotly contested`;
    if (highIntensityCount > 0) {
      narrative += `, with ${highIntensityCount} showing high-intensity disagreements (buy vs sell)`;
    }
    narrative += `. These disagreements often signal inflection points worth watching. `;
  }

  if (agentOutlooks.length === 3) {
    const stances = agentOutlooks.map((o) => o.stance);
    const uniqueStances = new Set(stances);
    if (uniqueStances.size === 1) {
      narrative += `Remarkably, all three agents share the same outlook — a rare alignment that historically precedes significant market moves.`;
    } else if (uniqueStances.size === 3) {
      narrative += `With three distinct outlooks, the market is at a genuine crossroads. This level of divergence among sophisticated AI models suggests elevated uncertainty and potential for volatility.`;
    } else {
      narrative += `Two agents align while one dissents — a common pattern that often rewards the dissenter if they're right, but validates the majority more often than not.`;
    }
  }

  return narrative;
}
