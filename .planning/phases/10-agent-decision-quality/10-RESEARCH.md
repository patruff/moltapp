# Phase 10: Agent Decision Quality - Research

**Researched:** 2026-02-05
**Domain:** AI trading agent decision quality metrics and evaluation
**Confidence:** HIGH (extensive existing codebase + industry research)

## Summary

This phase aims to improve agent trading quality through enhanced decision quality metrics and tracking. Research reveals that MoltApp already has a sophisticated decision quality infrastructure with 10+ dedicated services. However, there are opportunities to consolidate, improve visibility, and add missing metrics that industry research identifies as critical.

The existing codebase includes:
- **Confidence calibration** (`confidence-calibration-analyzer.ts`) - ECE, Brier score, reliability diagrams
- **Reasoning integrity** (`reasoning-integrity-engine.ts`) - flip-flop detection, copypasta, contradictions
- **Accountability tracking** (`decision-accountability-tracker.ts`) - claim registration and resolution
- **Cross-session memory** (`cross-session-memory-analyzer.ts`) - learning detection, mistake repetition
- **Outcome tracking** (`outcome-tracker.ts`, `outcome-resolution-engine.ts`) - P&L attribution

The gap is not in metrics themselves, but in:
1. **Unified visibility** - No single dashboard surfaces all decision quality metrics
2. **Real-time feedback** - Agents don't receive quality scores during trading
3. **Tool use quality** - Missing metrics for tool correctness and argument quality
4. **Plan adherence** - Missing explicit plan extraction and adherence scoring

**Primary recommendation:** Build a unified decision quality dashboard consolidating existing services, add tool use quality metrics, and create an agent feedback loop that surfaces quality scores in real-time.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | latest | Database queries | Already used throughout codebase |
| PostgreSQL | 15+ | Persistent storage | Existing infrastructure |
| Hono | latest | API routes | Existing framework |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| React + JSX | Hono/jsx | Dashboard rendering | Use existing `pages.tsx` pattern |
| TailwindCSS | 3.x | Styling | Consistent with existing UI |

### No New Libraries Needed
The codebase already has all necessary infrastructure. This phase is about consolidation and enhancement, not new dependencies.

**Installation:**
```bash
# No new installations required
# All dependencies already present in package.json
```

## Architecture Patterns

### Recommended Project Structure
The existing structure should be preserved and extended:
```
src/
├── services/
│   ├── decision-quality-dashboard.ts  # NEW: Consolidated aggregator
│   ├── tool-use-quality-analyzer.ts   # NEW: Tool correctness metrics
│   ├── confidence-calibration-analyzer.ts  # EXISTING
│   ├── reasoning-integrity-engine.ts       # EXISTING
│   ├── decision-accountability-tracker.ts  # EXISTING
│   ├── cross-session-memory-analyzer.ts    # EXISTING
│   └── outcome-tracker.ts                  # EXISTING
├── routes/
│   └── decision-quality-api.ts        # NEW: API endpoints
└── db/schema/
    └── decision-quality-snapshots.ts  # NEW: Aggregated metrics storage
```

### Pattern 1: Service Aggregation Pattern
**What:** Create a single service that orchestrates all existing quality services and provides unified metrics.
**When to use:** When consolidating multiple related services into a single view.
**Example:**
```typescript
// Source: MoltApp existing patterns in orchestrator.ts
interface DecisionQualityReport {
  agentId: string;
  timestamp: string;
  // Consolidated from existing services
  calibration: CalibrationAnalysis;        // from confidence-calibration-analyzer
  integrity: IntegrityReport;              // from reasoning-integrity-engine
  accountability: AccountabilityProfile;   // from decision-accountability-tracker
  memory: AgentMemoryProfile;              // from cross-session-memory-analyzer
  // New metrics
  toolUseQuality: ToolUseQualityReport;
  // Composite score
  compositeScore: number;
  grade: string;
}

export async function generateDecisionQualityReport(agentId: string): Promise<DecisionQualityReport> {
  const [calibration, integrity, accountability, memory, toolUse] = await Promise.all([
    analyzeCalibration(agentId),
    generateIntegrityReport(agentId),
    getAccountabilityProfile(agentId),
    getAgentMemoryProfile(agentId),
    analyzeToolUseQuality(agentId),
  ]);

  // Weighted composite score
  const compositeScore =
    calibration.ece * 0.15 +          // Lower ECE = better
    integrity.integrityScore * 0.20 +
    accountability.accountabilityScore * 0.20 +
    memory.memoryScore * 0.15 +
    toolUse.correctnessScore * 0.15 +
    toolUse.argumentQuality * 0.15;

  return { agentId, timestamp: new Date().toISOString(), calibration, integrity, accountability, memory, toolUseQuality: toolUse, compositeScore, grade: computeGrade(compositeScore) };
}
```

### Pattern 2: Tool Use Quality Tracking
**What:** Measure whether agents use tools correctly and with proper arguments.
**When to use:** Every time an agent makes a tool call.
**Example:**
```typescript
// Source: Industry research (DeepEval AI Agent Metrics)
interface ToolUseQualityReport {
  totalToolCalls: number;
  correctnessScore: number;      // Correctly Used Tools / Total Tools
  argumentQuality: number;       // Correct Input Parameters / Total Calls
  redundantCalls: number;        // Unnecessary repeated calls
  missingCalls: number;          // Required tools not called
  sequenceAdherence: number;     // Did agent follow required sequence?
}

export function analyzeToolUseQuality(agentId: string): ToolUseQualityReport {
  const toolTrace = getToolTraceForAgent(agentId);

  // Check required sequence: get_portfolio -> get_active_theses -> research
  const requiredFirst = ['get_portfolio', 'get_active_theses'];
  const sequenceCorrect = toolTrace.slice(0, 2).every(
    (call, i) => call.tool === requiredFirst[i]
  );

  // Check for buy/sell without thesis update/close
  const buySellWithoutThesis = toolTrace.filter(
    call => (call.tool === 'execute_trade' && call.arguments.action !== 'hold') &&
            !toolTrace.some(t => ['update_thesis', 'close_thesis'].includes(t.tool))
  );

  return {
    totalToolCalls: toolTrace.length,
    correctnessScore: calculateCorrectness(toolTrace),
    argumentQuality: calculateArgumentQuality(toolTrace),
    redundantCalls: countRedundantCalls(toolTrace),
    missingCalls: countMissingCalls(toolTrace),
    sequenceAdherence: sequenceCorrect ? 1.0 : 0.5,
  };
}
```

### Pattern 3: Real-time Feedback Loop
**What:** Surface quality scores to agents during their decision process.
**When to use:** At the start of each trading round in agent context.
**Example:**
```typescript
// Add to agent system prompt context
function buildQualityFeedbackContext(agentId: string): string {
  const report = getLatestQualityReport(agentId);

  return `
## Your Recent Decision Quality Scores

**Composite Score:** ${report.compositeScore}/100 (${report.grade})

**Calibration:** ${report.calibration.grade}
- Your confidence matches outcomes ${Math.round((1 - report.calibration.ece) * 100)}% of the time
- ${report.calibration.overconfidenceRatio > 0.5 ? 'WARNING: You are frequently overconfident. Lower your confidence scores.' : ''}

**Tool Use Quality:** ${Math.round(report.toolUseQuality.correctnessScore * 100)}%
- ${report.toolUseQuality.missingCalls > 0 ? 'WARNING: You are missing required tool calls (get_portfolio, get_active_theses).' : 'Good tool discipline.'}

**Memory/Learning:** ${report.memory.trend}
- ${report.memory.memoryWeaknesses.join(', ') || 'No major weaknesses detected.'}

Use this feedback to improve your decision quality this round.
`;
}
```

### Anti-Patterns to Avoid
- **Duplicating existing logic:** The codebase already has extensive quality tracking. Don't rebuild what exists.
- **Separate storage per metric:** Use unified snapshots, not separate tables per quality dimension.
- **Blocking trades on quality gates:** Quality should inform agents, not hard-block trading decisions.
- **Over-weighting single metrics:** Composite scores should balance multiple dimensions.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confidence calibration | Custom ECE calculation | `confidence-calibration-analyzer.ts` | Already implements ECE, Brier score, reliability diagrams |
| Flip-flop detection | Simple action comparison | `reasoning-integrity-engine.ts` | Has sophisticated same-symbol, timing-aware detection |
| Learning detection | Manual history comparison | `cross-session-memory-analyzer.ts` | 5 dimensions already tracked |
| Claim verification | Manual outcome matching | `decision-accountability-tracker.ts` | Automatic claim extraction and resolution |
| Outcome attribution | Manual P&L calculation | `outcome-tracker.ts` | Already handles buy/sell/hold P&L |

**Key insight:** MoltApp's decision quality infrastructure is already industry-leading. The gap is visibility and consolidation, not missing algorithms.

## Common Pitfalls

### Pitfall 1: Metric Inflation Through Easy Tests
**What goes wrong:** Quality metrics become meaningless if tests are too easy.
**Why it happens:** Natural tendency to show "good" scores to users/stakeholders.
**How to avoid:** Use industry-standard thresholds (ECE < 0.10 = good, not ECE < 0.30).
**Warning signs:** All agents consistently score 90%+ on every metric.

### Pitfall 2: Circular Feedback Loops
**What goes wrong:** Agents optimize for quality metrics rather than actual trading quality.
**Why it happens:** Showing quality scores to agents creates incentive to game them.
**How to avoid:** Use quality feedback for guidance, not as explicit optimization target. Focus feedback on behaviors ("you're overconfident") not scores ("your ECE is 0.15").
**Warning signs:** Quality scores improve but P&L stays flat or declines.

### Pitfall 3: Metric Fragmentation
**What goes wrong:** 10+ services each producing their own scores, no unified view.
**Why it happens:** Organic growth - each new metric gets its own service.
**How to avoid:** Create single aggregation layer that consolidates all metrics with consistent weighting.
**Warning signs:** Need to check 5+ different endpoints to understand agent quality.

### Pitfall 4: Ignoring Tool Use Quality
**What goes wrong:** Agents make "good" decisions based on incomplete information.
**Why it happens:** Only measuring outcome quality, not process quality.
**How to avoid:** Explicitly track tool call sequences, required calls, argument quality.
**Warning signs:** Agent trades without calling get_portfolio or get_active_theses first.

## Code Examples

Verified patterns from existing codebase:

### Composite Quality Score Calculation
```typescript
// Source: MoltApp existing services (benchmark scoring patterns)
function computeCompositeQualityScore(
  calibrationEce: number,
  integrityScore: number,
  accountabilityScore: number,
  memoryScore: number,
  toolCorrectness: number,
): number {
  // Weights based on importance for trading quality
  const weights = {
    calibration: 0.20,      // Is confidence predictive?
    integrity: 0.20,        // Is reasoning consistent?
    accountability: 0.20,   // Are claims accurate?
    memory: 0.15,           // Does agent learn?
    toolUse: 0.25,          // Does agent follow process?
  };

  // ECE is already 0-1 where lower is better, invert it
  const calibrationScore = 1 - calibrationEce;

  return (
    calibrationScore * weights.calibration +
    integrityScore * weights.integrity +
    accountabilityScore * weights.accountability +
    memoryScore * weights.memory +
    toolCorrectness * weights.toolUse
  );
}
```

### Tool Trace Analysis
```typescript
// Source: MoltApp trade-reasoning.ts schema + industry patterns
interface ToolCall {
  turn: number;
  tool: string;
  arguments: Record<string, string | number | boolean | string[]>;
  result: string;
  timestamp: string;
}

function validateToolSequence(toolTrace: ToolCall[]): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Required: get_portfolio must be first
  if (toolTrace.length > 0 && toolTrace[0].tool !== 'get_portfolio') {
    violations.push('Missing get_portfolio as first call');
  }

  // Required: get_active_theses should be second
  if (toolTrace.length > 1 && toolTrace[1].tool !== 'get_active_theses') {
    violations.push('Missing get_active_theses as second call');
  }

  // Check for trading without price check
  const hasTradeDecision = toolTrace.some(t =>
    t.tool === 'execute_trade' && t.arguments.action !== 'hold'
  );
  const hasPriceCheck = toolTrace.some(t => t.tool === 'get_stock_prices');

  if (hasTradeDecision && !hasPriceCheck) {
    violations.push('Trade decision without calling get_stock_prices');
  }

  // Check for buy without thesis
  const hasBuy = toolTrace.some(t =>
    t.tool === 'execute_trade' && t.arguments.action === 'buy'
  );
  const hasThesisUpdate = toolTrace.some(t => t.tool === 'update_thesis');

  if (hasBuy && !hasThesisUpdate) {
    violations.push('BUY decision without update_thesis call');
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
```

### Quality Grade Assignment
```typescript
// Source: MoltApp existing benchmark grading patterns
function computeGrade(score: number): string {
  if (score >= 0.95) return 'A+';
  if (score >= 0.90) return 'A';
  if (score >= 0.85) return 'A-';
  if (score >= 0.80) return 'B+';
  if (score >= 0.75) return 'B';
  if (score >= 0.70) return 'B-';
  if (score >= 0.65) return 'C+';
  if (score >= 0.60) return 'C';
  if (score >= 0.55) return 'C-';
  if (score >= 0.50) return 'D';
  return 'F';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| P&L only | Multi-dimensional quality | 2024+ | Process quality matters, not just outcomes |
| Single-trade analysis | Cross-trade integrity | 2025+ | Patterns across trades reveal true quality |
| Outcome-based calibration | ECE/Brier score | 2024+ | Statistically rigorous calibration measurement |
| Manual review | Automated trace analysis | 2025+ | Scale quality analysis to every trade |

**Industry trends (2026):**
- [AI-Trader benchmark](https://arxiv.org/abs/2512.10971) emphasizes "general intelligence does not automatically translate to effective trading capability"
- [DeepEval framework](https://deepeval.com/guides/guides-ai-agent-evaluation-metrics) distinguishes reasoning layer (plan quality), action layer (tool correctness), and execution layer (task completion) metrics
- [Braintrust framework](https://www.braintrust.dev/articles/ai-agent-evaluation-framework) emphasizes tracing infrastructure that captures "which tool it selected, what arguments it constructed, and what response it received"

## Open Questions

Things that couldn't be fully resolved:

1. **How heavily to weight tool use vs outcome quality?**
   - What we know: Industry research emphasizes process quality, but P&L is ultimate trading metric
   - What's unclear: Optimal weight ratio for trading specifically
   - Recommendation: Start with 25% tool use weight, adjust based on correlation with P&L improvement

2. **Should quality scores be shown to agents during trading?**
   - What we know: Feedback loops can help or create gaming
   - What's unclear: Whether LLM agents respond well to meta-feedback
   - Recommendation: Implement with toggle, A/B test impact on decision quality

3. **How to handle benchmark engine integration?**
   - What we know: There are 8+ benchmark engine versions (v30-v37)
   - What's unclear: Which version decision quality metrics should integrate with
   - Recommendation: Create standalone service, benchmark engines can import as needed

## Sources

### Primary (HIGH confidence)
- MoltApp codebase analysis - `confidence-calibration-analyzer.ts`, `reasoning-integrity-engine.ts`, `decision-accountability-tracker.ts`, `cross-session-memory-analyzer.ts`, `outcome-tracker.ts`
- MoltApp schema analysis - `trade-reasoning.ts` (tradeJustifications table with coherenceScore, hallucinationFlags, disciplinePass)

### Secondary (MEDIUM confidence)
- [DeepEval AI Agent Evaluation Metrics](https://deepeval.com/guides/guides-ai-agent-evaluation-metrics) - Tool correctness, argument correctness, plan quality metrics
- [Braintrust AI Agent Evaluation Framework](https://www.braintrust.dev/articles/ai-agent-evaluation-framework) - Tracing infrastructure, execution trace analysis

### Tertiary (LOW confidence - need validation)
- [AI-Trader benchmark paper](https://arxiv.org/abs/2512.10971) - Live trading benchmark approach
- General LLM evaluation trends from WebSearch

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed, using existing infrastructure
- Architecture: HIGH - Patterns match existing codebase conventions
- Pitfalls: HIGH - Based on actual codebase analysis + industry research

**Research date:** 2026-02-05
**Valid until:** 60 days (stable domain, existing infrastructure well-established)

## Recommendations Summary

### Must Do
1. Create unified `decision-quality-dashboard.ts` service consolidating all existing quality services
2. Add `tool-use-quality-analyzer.ts` for tool correctness and sequence validation
3. Add `/decision-quality` route in pages.tsx with consolidated view
4. Store periodic quality snapshots for trend analysis

### Should Do
1. Add quality feedback to agent system prompt context
2. Create API endpoints for quality metrics (`/api/v1/agents/:id/decision-quality`)
3. Add quality trend visualization to agent profile page

### Could Do
1. A/B test impact of quality feedback on agent performance
2. Add real-time quality alerts for severe violations
3. Export quality metrics to HuggingFace benchmark dataset
