/**
 * Market Hours & Trading Session Manager
 *
 * Manages trading sessions based on US stock market hours.
 * xStocks (tokenized equities) track real stocks, so trading decisions should
 * align with when underlying markets are open and price feeds are active.
 *
 * Features:
 * - US market hours detection (NYSE/NASDAQ: 9:30 AM - 4:00 PM ET)
 * - Pre-market and after-hours session detection
 * - Holiday calendar (2025-2026 US market holidays)
 * - Trading policy enforcement: block/allow/warn per session type
 * - Configurable session policies for each agent
 * - Early close detection (e.g., day before Thanksgiving)
 *
 * Note: xStocks trade 24/7 on Solana, but price feeds and liquidity are
 * significantly better during market hours. This service provides ADVISORY
 * session awareness — the orchestrator decides whether to enforce it.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketSession =
  | "pre_market"      // 4:00 AM - 9:30 AM ET
  | "regular"         // 9:30 AM - 4:00 PM ET
  | "after_hours"     // 4:00 PM - 8:00 PM ET
  | "closed"          // 8:00 PM - 4:00 AM ET
  | "weekend"         // Saturday/Sunday
  | "holiday";        // US market holidays

export type TradingPolicy =
  | "allow"           // Normal trading allowed
  | "warn"            // Trading allowed but with a warning
  | "restrict"        // Only high-confidence trades (>80%)
  | "block";          // No trading allowed

export interface SessionInfo {
  session: MarketSession;
  policy: TradingPolicy;
  isOpen: boolean;
  currentTimeET: string;
  nextOpen: string;
  nextClose: string;
  /** Holiday name if today is a holiday */
  holiday?: string;
  /** Whether this is an early close day */
  earlyClose: boolean;
  /** Minutes until next session change */
  minutesUntilChange: number;
  /** Reason for policy (e.g., "Market closed — weekend") */
  policyReason: string;
}

export interface MarketHoursConfig {
  /** Policy for each session type */
  sessionPolicies: Record<MarketSession, TradingPolicy>;
  /** Minimum confidence required during restricted sessions */
  restrictedMinConfidence: number;
  /** Timezone to use (only "America/New_York" is supported) */
  timezone: string;
  /** Enable/disable market hours enforcement */
  enforceMarketHours: boolean;
}

export interface TradingSessionCheck {
  allowed: boolean;
  session: MarketSession;
  policy: TradingPolicy;
  reason: string;
  /** Confidence threshold override (null = no override) */
  confidenceOverride: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** US market holidays for 2025 and 2026. Dates in MM-DD format. */
const US_MARKET_HOLIDAYS: Record<string, string> = {
  // 2025
  "2025-01-01": "New Year's Day",
  "2025-01-20": "Martin Luther King Jr. Day",
  "2025-02-17": "Presidents' Day",
  "2025-04-18": "Good Friday",
  "2025-05-26": "Memorial Day",
  "2025-06-19": "Juneteenth",
  "2025-07-04": "Independence Day",
  "2025-09-01": "Labor Day",
  "2025-11-27": "Thanksgiving",
  "2025-12-25": "Christmas Day",
  // 2026
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Presidents' Day",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Christmas Day",
};

/** Early close dates (1:00 PM ET close). */
const EARLY_CLOSE_DATES: Set<string> = new Set([
  "2025-07-03",    // Day before Independence Day
  "2025-11-28",    // Day after Thanksgiving
  "2025-12-24",    // Christmas Eve
  "2026-11-27",    // Day after Thanksgiving
  "2026-12-24",    // Christmas Eve
]);

/** Session time boundaries in Eastern Time (minutes from midnight). */
const SESSION_BOUNDARIES = {
  PRE_MARKET_START: 4 * 60,         // 4:00 AM
  REGULAR_START: 9 * 60 + 30,       // 9:30 AM
  REGULAR_CLOSE: 16 * 60,           // 4:00 PM
  EARLY_CLOSE: 13 * 60,             // 1:00 PM
  AFTER_HOURS_END: 20 * 60,         // 8:00 PM
} as const;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let marketConfig: MarketHoursConfig = {
  sessionPolicies: {
    pre_market: "warn",
    regular: "allow",
    after_hours: "warn",
    closed: "restrict",
    weekend: "restrict",
    holiday: "block",
  },
  restrictedMinConfidence: 80,
  timezone: "America/New_York",
  enforceMarketHours: true,
};

// ---------------------------------------------------------------------------
// Time Utilities
// ---------------------------------------------------------------------------

/**
 * Get the current date/time in Eastern Time.
 */
function getEasternTime(date?: Date): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  dayOfWeek: number;
  dateStr: string;
  timeStr: string;
  minutesSinceMidnight: number;
} {
  const d = date ?? new Date();

  // Format in Eastern Time
  const etString = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Parse: "MM/DD/YYYY, HH:MM"
  const parts = etString.split(", ");
  const dateParts = parts[0].split("/");
  const timeParts = parts[1].split(":");

  const month = parseInt(dateParts[0], 10);
  const day = parseInt(dateParts[1], 10);
  const year = parseInt(dateParts[2], 10);
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);

  // Get day of week in ET
  const etDate = new Date(
    d.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const dayOfWeek = etDate.getDay(); // 0=Sun, 6=Sat

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    dayOfWeek,
    dateStr,
    timeStr,
    minutesSinceMidnight: hours * 60 + minutes,
  };
}

// ---------------------------------------------------------------------------
// Core Session Detection
// ---------------------------------------------------------------------------

/**
 * Determine the current market session.
 */
export function getCurrentSession(date?: Date): SessionInfo {
  const et = getEasternTime(date);

  // Check weekend
  if (et.dayOfWeek === 0 || et.dayOfWeek === 6) {
    return buildSessionInfo("weekend", et);
  }

  // Check holiday
  const holiday = US_MARKET_HOLIDAYS[et.dateStr];
  if (holiday) {
    return buildSessionInfo("holiday", et, holiday);
  }

  // Check early close
  const isEarlyClose = EARLY_CLOSE_DATES.has(et.dateStr);
  const closeTime = isEarlyClose
    ? SESSION_BOUNDARIES.EARLY_CLOSE
    : SESSION_BOUNDARIES.REGULAR_CLOSE;

  const mins = et.minutesSinceMidnight;

  // Determine session
  let session: MarketSession;
  if (mins < SESSION_BOUNDARIES.PRE_MARKET_START) {
    session = "closed";
  } else if (mins < SESSION_BOUNDARIES.REGULAR_START) {
    session = "pre_market";
  } else if (mins < closeTime) {
    session = "regular";
  } else if (mins < SESSION_BOUNDARIES.AFTER_HOURS_END) {
    session = "after_hours";
  } else {
    session = "closed";
  }

  return buildSessionInfo(session, et, undefined, isEarlyClose);
}

/**
 * Build a complete SessionInfo object.
 */
function buildSessionInfo(
  session: MarketSession,
  et: ReturnType<typeof getEasternTime>,
  holiday?: string,
  earlyClose = false,
): SessionInfo {
  const policy = marketConfig.sessionPolicies[session];
  const isOpen = session === "regular";

  const closeTime = earlyClose
    ? SESSION_BOUNDARIES.EARLY_CLOSE
    : SESSION_BOUNDARIES.REGULAR_CLOSE;

  // Calculate minutes until next session change
  let minutesUntilChange: number;
  const mins = et.minutesSinceMidnight;

  switch (session) {
    case "closed":
      if (mins < SESSION_BOUNDARIES.PRE_MARKET_START) {
        minutesUntilChange = SESSION_BOUNDARIES.PRE_MARKET_START - mins;
      } else {
        // After 8 PM, next change is pre-market at 4 AM (next day)
        minutesUntilChange = 24 * 60 - mins + SESSION_BOUNDARIES.PRE_MARKET_START;
      }
      break;
    case "pre_market":
      minutesUntilChange = SESSION_BOUNDARIES.REGULAR_START - mins;
      break;
    case "regular":
      minutesUntilChange = closeTime - mins;
      break;
    case "after_hours":
      minutesUntilChange = SESSION_BOUNDARIES.AFTER_HOURS_END - mins;
      break;
    case "weekend": {
      // Days until Monday
      const daysUntilMonday = et.dayOfWeek === 6 ? 2 : 1;
      minutesUntilChange =
        daysUntilMonday * 24 * 60 -
        mins +
        SESSION_BOUNDARIES.PRE_MARKET_START;
      break;
    }
    case "holiday":
      // Next business day
      minutesUntilChange =
        24 * 60 - mins + SESSION_BOUNDARIES.PRE_MARKET_START;
      break;
    default:
      minutesUntilChange = 0;
  }

  // Calculate next open/close times
  const nextOpen = computeNextOpen(et);
  const nextClose = computeNextClose(et, earlyClose);

  const policyReason = buildPolicyReason(session, policy, holiday);

  return {
    session,
    policy,
    isOpen,
    currentTimeET: `${et.dateStr} ${et.timeStr} ET`,
    nextOpen,
    nextClose,
    holiday,
    earlyClose,
    minutesUntilChange,
    policyReason,
  };
}

/**
 * Compute the next market open time as a human-readable string.
 */
function computeNextOpen(et: ReturnType<typeof getEasternTime>): string {
  const mins = et.minutesSinceMidnight;

  // If before regular open today (and it's a weekday, not holiday)
  if (
    et.dayOfWeek >= 1 &&
    et.dayOfWeek <= 5 &&
    !US_MARKET_HOLIDAYS[et.dateStr] &&
    mins < SESSION_BOUNDARIES.REGULAR_START
  ) {
    return `Today ${formatMinutes(SESSION_BOUNDARIES.REGULAR_START)} ET`;
  }

  // Find next weekday
  let daysAhead = 1;
  const baseDate = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );

  for (let i = 0; i < 10; i++) {
    const nextDate = new Date(baseDate);
    nextDate.setDate(nextDate.getDate() + daysAhead);
    const dow = nextDate.getDay();
    const dateStr = formatDate(nextDate);

    if (dow >= 1 && dow <= 5 && !US_MARKET_HOLIDAYS[dateStr]) {
      return `${dateStr} ${formatMinutes(SESSION_BOUNDARIES.REGULAR_START)} ET`;
    }
    daysAhead++;
  }

  return "Unknown";
}

/**
 * Compute the next market close time.
 */
function computeNextClose(
  et: ReturnType<typeof getEasternTime>,
  earlyClose: boolean,
): string {
  const mins = et.minutesSinceMidnight;
  const closeTime = earlyClose
    ? SESSION_BOUNDARIES.EARLY_CLOSE
    : SESSION_BOUNDARIES.REGULAR_CLOSE;

  // If market is currently open
  if (
    et.dayOfWeek >= 1 &&
    et.dayOfWeek <= 5 &&
    !US_MARKET_HOLIDAYS[et.dateStr] &&
    mins >= SESSION_BOUNDARIES.REGULAR_START &&
    mins < closeTime
  ) {
    return `Today ${formatMinutes(closeTime)} ET`;
  }

  return "Next trading day";
}

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildPolicyReason(
  session: MarketSession,
  policy: TradingPolicy,
  holiday?: string,
): string {
  switch (session) {
    case "regular":
      return "Market is open — normal trading";
    case "pre_market":
      return "Pre-market session — reduced liquidity, wider spreads";
    case "after_hours":
      return "After-hours session — reduced liquidity, wider spreads";
    case "closed":
      return "Market closed — no price updates, stale data risk";
    case "weekend":
      return "Weekend — markets closed until Monday";
    case "holiday":
      return `Market holiday: ${holiday ?? "Unknown"} — no trading`;
    default:
      return `Session: ${session}, Policy: ${policy}`;
  }
}

// ---------------------------------------------------------------------------
// Trading Policy Enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether a trade should proceed based on current market session.
 *
 * Returns an advisory result — the orchestrator decides whether to enforce it.
 */
export function checkTradingSession(
  confidence: number,
  date?: Date,
): TradingSessionCheck {
  const session = getCurrentSession(date);

  if (!marketConfig.enforceMarketHours) {
    return {
      allowed: true,
      session: session.session,
      policy: "allow",
      reason: "Market hours enforcement disabled",
      confidenceOverride: null,
    };
  }

  const policy = session.policy;

  switch (policy) {
    case "allow":
      return {
        allowed: true,
        session: session.session,
        policy,
        reason: session.policyReason,
        confidenceOverride: null,
      };

    case "warn":
      return {
        allowed: true,
        session: session.session,
        policy,
        reason: `Warning: ${session.policyReason}`,
        confidenceOverride: null,
      };

    case "restrict": {
      const meetsThreshold =
        confidence >= marketConfig.restrictedMinConfidence;
      return {
        allowed: meetsThreshold,
        session: session.session,
        policy,
        reason: meetsThreshold
          ? `Restricted session: confidence ${confidence}% meets threshold ${marketConfig.restrictedMinConfidence}%`
          : `Blocked: confidence ${confidence}% below restricted threshold ${marketConfig.restrictedMinConfidence}%`,
        confidenceOverride: marketConfig.restrictedMinConfidence,
      };
    }

    case "block":
      return {
        allowed: false,
        session: session.session,
        policy,
        reason: `Blocked: ${session.policyReason}`,
        confidenceOverride: null,
      };

    default:
      return {
        allowed: true,
        session: session.session,
        policy: "allow",
        reason: "Unknown policy — defaulting to allow",
        confidenceOverride: null,
      };
  }
}

// ---------------------------------------------------------------------------
// Session Schedule
// ---------------------------------------------------------------------------

/**
 * Get the full trading schedule for today (all session boundaries).
 */
export function getTodaySchedule(date?: Date): {
  date: string;
  dayOfWeek: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holiday?: string;
  earlyClose: boolean;
  sessions: Array<{
    session: MarketSession;
    startET: string;
    endET: string;
    policy: TradingPolicy;
  }>;
} {
  const et = getEasternTime(date);
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const isWeekend = et.dayOfWeek === 0 || et.dayOfWeek === 6;
  const holiday = US_MARKET_HOLIDAYS[et.dateStr];
  const isEarlyClose = EARLY_CLOSE_DATES.has(et.dateStr);
  const closeTime = isEarlyClose
    ? SESSION_BOUNDARIES.EARLY_CLOSE
    : SESSION_BOUNDARIES.REGULAR_CLOSE;

  if (isWeekend || holiday) {
    return {
      date: et.dateStr,
      dayOfWeek: dayNames[et.dayOfWeek],
      isWeekend,
      isHoliday: !!holiday,
      holiday: holiday ?? undefined,
      earlyClose: false,
      sessions: [
        {
          session: isWeekend ? "weekend" : "holiday",
          startET: "12:00 AM",
          endET: "11:59 PM",
          policy: marketConfig.sessionPolicies[isWeekend ? "weekend" : "holiday"],
        },
      ],
    };
  }

  return {
    date: et.dateStr,
    dayOfWeek: dayNames[et.dayOfWeek],
    isWeekend: false,
    isHoliday: false,
    earlyClose: isEarlyClose,
    sessions: [
      {
        session: "closed",
        startET: "12:00 AM",
        endET: formatMinutes(SESSION_BOUNDARIES.PRE_MARKET_START),
        policy: marketConfig.sessionPolicies.closed,
      },
      {
        session: "pre_market",
        startET: formatMinutes(SESSION_BOUNDARIES.PRE_MARKET_START),
        endET: formatMinutes(SESSION_BOUNDARIES.REGULAR_START),
        policy: marketConfig.sessionPolicies.pre_market,
      },
      {
        session: "regular",
        startET: formatMinutes(SESSION_BOUNDARIES.REGULAR_START),
        endET: formatMinutes(closeTime),
        policy: marketConfig.sessionPolicies.regular,
      },
      {
        session: "after_hours",
        startET: formatMinutes(closeTime),
        endET: formatMinutes(SESSION_BOUNDARIES.AFTER_HOURS_END),
        policy: marketConfig.sessionPolicies.after_hours,
      },
      {
        session: "closed",
        startET: formatMinutes(SESSION_BOUNDARIES.AFTER_HOURS_END),
        endET: "11:59 PM",
        policy: marketConfig.sessionPolicies.closed,
      },
    ],
  };
}

/**
 * Get upcoming holidays.
 */
export function getUpcomingHolidays(
  limit = 5,
): Array<{ date: string; name: string; daysAway: number }> {
  const today = new Date();
  const todayStr = formatDate(today);

  return Object.entries(US_MARKET_HOLIDAYS)
    .filter(([date]) => date >= todayStr)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([date, name]) => {
      const holidayDate = new Date(date + "T12:00:00");
      const daysAway = Math.ceil(
        (holidayDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
      );
      return { date, name, daysAway };
    });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update market hours configuration.
 */
export function configureMarketHours(
  updates: Partial<MarketHoursConfig>,
): MarketHoursConfig {
  if (updates.sessionPolicies) {
    marketConfig.sessionPolicies = {
      ...marketConfig.sessionPolicies,
      ...updates.sessionPolicies,
    };
  }
  if (updates.restrictedMinConfidence !== undefined) {
    marketConfig.restrictedMinConfidence = updates.restrictedMinConfidence;
  }
  if (updates.enforceMarketHours !== undefined) {
    marketConfig.enforceMarketHours = updates.enforceMarketHours;
  }

  console.log(
    `[MarketHours] Config updated: enforce=${marketConfig.enforceMarketHours}, ` +
      `restrictedMinConf=${marketConfig.restrictedMinConfidence}`,
  );
  return marketConfig;
}

/**
 * Get current market hours configuration.
 */
export function getMarketHoursConfig(): MarketHoursConfig {
  return { ...marketConfig };
}
