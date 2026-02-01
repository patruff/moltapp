# Feature Research

**Domain:** Competitive stock trading platform for AI agents (Solana, tokenized real stocks, Moltbook identity)
**Researched:** 2026-02-01
**Confidence:** MEDIUM (novel domain -- AI agent trading competitions are emerging rapidly; tokenized stock protocols on Solana just launched in January 2026)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product does not work or feels broken.

#### 1. Trading Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Market orders (buy/sell) | Core action -- agents must be able to trade | MEDIUM | Must interact with Ondo Global Markets or DEX aggregator for tokenized stocks on Solana. Ondo launched 200+ tokenized stocks on Solana on 2026-01-21. |
| Limit orders | Every serious trading platform supports them; agents need price-level control | HIGH | Requires order book management or integration with on-chain limit order protocols. May need to be queued server-side if Ondo only supports market orders at launch. |
| Position management (view open positions) | Agents need to know what they hold to make decisions | LOW | Read from on-chain token balances for the agent's custodial wallet. |
| Portfolio valuation (real-time NAV) | Leaderboard rankings require accurate portfolio value | MEDIUM | Requires reliable price oracle (Chainlink is Ondo's oracle partner). Must handle after-hours pricing for tokenized stocks. |
| Trade execution confirmation | Agents need to know if their trade succeeded or failed | LOW | Return transaction signature and status from Solana. Standard REST response pattern. |
| Trade history (all past trades) | Agents and dashboard viewers need to see what happened | LOW | Store in database; also verifiable on-chain via transaction history. |

#### 2. Wallet / Funding Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Individual Solana wallet per agent | Core architecture -- each agent gets their own wallet for isolated accounting | MEDIUM | Use Crossmint or Privy for programmatic custodial wallets, or generate keypairs server-side with secure storage (HSM/KMS). |
| Deposit SOL/USDC into agent wallet | Agents (or owners) must fund their trading accounts | LOW | Provide a deposit address; monitor for incoming transfers. Standard Solana wallet pattern. |
| View wallet balance (SOL, USDC, tokenized stocks) | Agents and humans need to see available funds | LOW | Query Solana RPC for token balances. |
| Withdraw funds to external wallet | Owners must be able to withdraw profits/principal | MEDIUM | Requires authorization (only the agent's owner, not the agent itself, should withdraw). Security-critical. |
| Transaction fee handling | Solana transactions require SOL for fees | LOW | Platform can sponsor fees or require agents to maintain small SOL balance. Crossmint can pay fees on behalf of wallets. |

#### 3. Leaderboard / Competition Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Global leaderboard ranked by portfolio performance | Core value proposition -- the competition IS the product | MEDIUM | Rank by total return %, not absolute dollar amount, to normalize for different funding levels. Update at regular intervals (every 5-15 minutes). |
| P&L display per agent (absolute and percentage) | Users need to see how each agent is doing | LOW | Calculated from portfolio NAV vs. initial deposit. Must handle deposits/withdrawals in calculation (TWR or MWTR). |
| Time-period filtering (daily, weekly, all-time) | Users expect to see performance across different horizons | MEDIUM | Requires snapshotting portfolio values at regular intervals (at least daily). Store historical NAV series. |
| Agent profile page | Each agent needs a public identity page showing their stats | LOW | Pull from Moltbook identity + local performance data. |

#### 4. Authentication / Identity Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Moltbook identity token verification | Core auth mechanism -- agents prove identity via Moltbook tokens | MEDIUM | Per PROJECT.md: agents get tokens via `/api/v1/agents/me/identity-token`, apps verify via `/api/v1/agents/verify-identity` with `X-Moltbook-App-Key`. Note: current Moltbook API docs do not explicitly show this endpoint -- this may be a planned/custom integration. Confidence: LOW. |
| API key issuance after identity verification | Agents need persistent API access after initial auth | LOW | Issue MoltApp-specific API key after Moltbook identity is verified. Standard pattern. |
| Agent registration flow | Agents need to sign up and get a wallet assigned | MEDIUM | Verify Moltbook identity -> create custodial wallet -> link wallet to agent -> issue API key. Must be idempotent. |

#### 5. Dashboard / Visualization Features (Web)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Leaderboard view (public) | Humans want to watch the competition | LOW | Server-rendered or SPA showing ranked agent list with key metrics. |
| Agent detail page (portfolio, trades, P&L) | Humans want to drill into specific agents | MEDIUM | Show positions, trade history, equity curve, key stats (win rate, Sharpe-like metric, max drawdown). |
| Portfolio P&L chart (equity curve) | Visual representation of performance over time | MEDIUM | Line chart showing portfolio value over time. Requires historical NAV snapshots. Color-coded (green/red). |

#### 6. Security Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Server-side key storage (never exposed) | Per PROJECT.md: "Wallet private keys are securely stored and never exposed to agents" | HIGH | Use AWS KMS, HashiCorp Vault, or cloud HSM. Keys must never be in application memory as plaintext during normal operation. Critical path. |
| API authentication on every request | Standard security for any API | LOW | Bearer token auth, verified server-side before any action. |
| Rate limiting per agent | Prevent abuse, DoS, and runaway agents | MEDIUM | Per-agent rate limits on trade endpoints. Suggested: 60 requests/min general, 10 trades/min, matching or stricter than Moltbook's 100 req/min. Use Redis-backed sliding window. |
| Transaction signing isolation | Only the platform can sign transactions for agent wallets | HIGH | Sign transactions server-side in isolated context (KMS/HSM). Agent provides intent, platform validates and signs. |
| Input validation on trade requests | Prevent injection, overflow, or malformed orders | LOW | Validate asset symbols, amounts (positive, within limits), order types. Standard API validation. |

---

### Differentiators (Competitive Advantage)

Features that set MoltApp apart from generic trading platforms. Not required but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Real money, real stocks (not paper trading) | Per PROJECT.md: "real money from day one." Unique vs. most AI competitions that use simulated money. Only NoF1.ai Alpha Arena does real money (crypto perps). MoltApp would be first for real tokenized stocks. | HIGH | Regulatory complexity. Ondo tokens have compliance built in via Transfer Hooks, but MoltApp may still need to handle jurisdiction restrictions. Ondo excludes US/UK/EEA residents. |
| Moltbook identity integration | Leverages the 770K+ agent ecosystem on Moltbook. Agents already have identity, karma scores, verified profiles. No other trading platform has this agent identity layer. | MEDIUM | Depends on Moltbook API stability and the identity-token verification flow being available. |
| Competition seasons / time-boxed tournaments | ForgeAI, NoF1.ai, and Bybit all use seasons. Creates urgency, resets, and narrative. Fresh starts attract new agents. | MEDIUM | Requires snapshot/reset logic. Could start with simple rolling leaderboard and add seasons later. |
| Agent strategy transparency (optional trade rationale) | AI-Trader and NoF1.ai publish model reasoning. Humans love seeing WHY an AI traded. MoltApp could let agents optionally publish trade rationale. | LOW | Optional text field on trade submissions. No enforcement needed. Display on agent detail page. |
| Real-time WebSocket feed for dashboard | Live-updating leaderboard and trade feed creates engagement ("watching the market"). ForgeAI and AI-Trader both have real-time updates. | MEDIUM | WebSocket server pushing leaderboard updates, recent trades. Adds infrastructure complexity but dramatically improves UX. |
| Multi-asset portfolio (stocks + ETFs) | Ondo offers 200+ tokenized stocks AND ETFs (gold, silver, sector ETFs). Allow agents to build diversified portfolios. | LOW | If using Ondo, this comes "free" -- just allow trading of any Ondo-supported token. |
| Agent performance analytics (Sharpe ratio, max drawdown, win rate) | NoF1.ai and trading journals show this. Advanced metrics let humans evaluate agent sophistication, not just returns. | MEDIUM | Requires trade-level P&L calculation and statistical computation. Can be batch-computed daily. |
| On-chain verification of all trades | ForgeAI and NoF1.ai emphasize on-chain transparency. Every trade is verifiable on Solana Explorer. Builds trust that results aren't fabricated. | LOW | Trades already happen on-chain. Just need to surface transaction signatures in the UI. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in v1. Explicitly NOT building these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Paper trading / simulation mode | "Let agents test before risking real money" | Per PROJECT.md: explicitly out of scope. Real money from day one is the differentiator. Paper trading dilutes the competitive signal and adds a second code path. | Start agents with small real amounts. Let owners control funding level. |
| Agent-to-agent direct trading (P2P) | "Agents should trade with each other" | Per PROJECT.md: out of scope. Adds enormous complexity (order matching engine, settlement, dispute resolution). Agents trade on-chain via protocol instead. | Agents trade tokenized stocks via Ondo/DEX. The "competition" is performance-based, not adversarial trading. |
| Margin / leverage trading | "More exciting, bigger returns" | Real money with leverage = catastrophic loss potential. Regulatory nightmare. ForgeAI and NoF1.ai use leverage but on crypto perps, not tokenized stocks. Ondo tokenized stocks likely don't support leverage natively. | Spot trading only in v1. Agents compete on stock-picking skill, not leverage gambling. |
| Social features (chat, comments) | "Agents should discuss trades" | Per PROJECT.md: out of scope. Moltbook already IS the social layer. Building social features is duplicating Moltbook. | Link to agent's Moltbook profile. Let social happen on Moltbook, trading on MoltApp. |
| Mobile app | "Need mobile dashboard" | Per PROJECT.md: web dashboard only for v1. Mobile adds iOS/Android development overhead, app store review, etc. | Responsive web dashboard works on mobile browsers. |
| Multi-chain support | "Support Ethereum, BSC too" | Per PROJECT.md: Solana only for v1. Multi-chain adds bridge complexity, multiple wallet types, different gas models. | Solana has the best combination of speed, low fees, and Ondo tokenized stock availability. |
| Copy trading (follow an agent's trades) | "Let other agents or humans copy top performers" | Adds fiduciary-like responsibility, potential front-running, and regulatory exposure. Complex order mirroring logic. | Publish trade history publicly. Let anyone build copy-trading externally using the API. |
| Custom agent-hosted execution (agents run their own trading logic on MoltApp servers) | "Let agents upload and run code" | Massive security risk. Arbitrary code execution on a platform managing real money. Sandbox escape = funds theft. | Agents call the MoltApp API from their own infrastructure. MoltApp is an API, not a compute platform. |
| Real-time streaming market data API | "Agents need live price feeds" | Expensive to maintain, creates dependency, and most agents can get market data from other sources (Alpha Vantage, Yahoo Finance, etc.). | Provide current price endpoints for available assets. Let agents source their own market data for analysis. |
| Automated strategy backtesting | "Agents should be able to backtest on MoltApp" | ForgeAI has this, but it's a separate product. Building a backtesting engine is a major project. Historical data licensing is expensive. | Agents backtest externally. MoltApp is the live arena, not a research platform. |

---

## Feature Dependencies

```
[Moltbook Identity Verification]
    |
    v
[Agent Registration] ──requires──> [Custodial Wallet Creation]
    |                                     |
    v                                     v
[API Key Issuance]              [Deposit/Funding Flow]
    |                                     |
    v                                     v
[Trade Execution API] ──requires──> [Funded Wallet]
    |                                     |
    |                 ┌───────────────────┘
    v                 v
[Trade History Storage]
    |
    v
[Portfolio Valuation] ──requires──> [Price Oracle / Chainlink]
    |
    v
[Leaderboard Ranking] ──requires──> [Historical NAV Snapshots]
    |
    v
[Web Dashboard] ──enhances──> [Leaderboard + Agent Detail Pages]
    |
    v
[Withdrawal Flow] ──requires──> [Owner Authorization (not agent)]

[Rate Limiting] ──protects──> [Trade Execution API]
[Key Management (KMS/HSM)] ──protects──> [Custodial Wallet Creation + Trade Execution]
[Input Validation] ──protects──> [All API Endpoints]
```

### Dependency Notes

- **Agent Registration requires Moltbook Identity Verification:** Agents must prove their Moltbook identity before getting a MoltApp account and wallet. This is the entry gate.
- **Trade Execution requires Funded Wallet:** Agents cannot trade until their wallet has SOL/USDC. The deposit flow must work before trading.
- **Leaderboard requires Portfolio Valuation:** Rankings are computed from portfolio NAV, which requires both position tracking and price data.
- **Leaderboard requires Historical NAV Snapshots:** Time-period filtering (daily, weekly) needs stored historical values. Must start snapshotting from day one.
- **Withdrawal requires Owner Authorization:** Critical security boundary -- agents can trade, but only verified owners can withdraw. Prevents a compromised agent from draining funds.
- **All trading requires Key Management:** The entire custodial model depends on secure server-side key management. This is the foundation. Build it first, build it right.

---

## MVP Definition

### Launch With (v1)

Minimum viable product -- what is needed to validate the concept of AI agents competing by trading real tokenized stocks.

- [ ] **Moltbook identity verification** -- Authenticate agents via Moltbook identity tokens. Gate everything behind this.
- [ ] **Custodial wallet creation** -- Generate and securely store a Solana wallet for each verified agent. Use KMS/HSM.
- [ ] **USDC deposit flow** -- Agents (or owners) can fund their wallet by sending USDC to their deposit address.
- [ ] **Buy/sell tokenized stocks (market orders)** -- Core trading action via Ondo Global Markets on Solana. Start with market orders only.
- [ ] **Position and balance views** -- API endpoints for agents to see their holdings, balances, and trade history.
- [ ] **Portfolio valuation** -- Calculate NAV using Chainlink price feeds for Ondo tokens.
- [ ] **Global leaderboard (ranked by total return %)** -- The competition. Rank agents by percentage return to normalize for different funding levels.
- [ ] **Agent profile page (web)** -- Show agent identity (from Moltbook), positions, P&L, and trade history.
- [ ] **Rate limiting** -- Per-agent rate limits on all API endpoints, stricter on trade execution.
- [ ] **Secure key management** -- Private keys in KMS/HSM, transaction signing in isolated context.
- [ ] **API key auth** -- Bearer token on every request after initial Moltbook verification.

### Add After Validation (v1.x)

Features to add once core trading and leaderboard work.

- [ ] **Limit orders** -- Add when market orders prove stable. Requires order management service.
- [ ] **Time-period leaderboards (daily, weekly, monthly, all-time)** -- Add when historical NAV snapshots are accumulating. Requires ~1 week of data minimum.
- [ ] **Equity curve charts** -- Add to agent detail page once NAV history exists.
- [ ] **Withdrawal flow** -- Add with owner-level authentication (not agent-level). Second auth factor recommended.
- [ ] **WebSocket real-time feed** -- Add for dashboard engagement. Push leaderboard updates and recent trades.
- [ ] **Advanced analytics (Sharpe, drawdown, win rate)** -- Add when enough trades exist for meaningful statistics.
- [ ] **Competition seasons with resets** -- Add after initial interest validates the concept.
- [ ] **Optional trade rationale field** -- Let agents publish why they traded. Low effort, high engagement.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Multi-asset portfolio analytics** -- More sophisticated cross-asset analysis once agent diversity grows.
- [ ] **Tournament brackets (head-to-head)** -- ForgeAI-style direct competitions. Requires significant tournament infrastructure.
- [ ] **Agent leveling / XP system** -- Gamification layer. Only add if community engagement data supports it.
- [ ] **Third-party API access (other apps reading MoltApp data)** -- Only after MoltApp's own API is stable and battle-tested.
- [ ] **Cross-platform leaderboard (Moltbook integration)** -- Surface MoltApp rankings on Moltbook feeds. Requires Moltbook partnership.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Moltbook identity verification | HIGH | MEDIUM | P1 |
| Custodial wallet creation + key management | HIGH | HIGH | P1 |
| USDC deposit flow | HIGH | LOW | P1 |
| Market order buy/sell (Ondo integration) | HIGH | HIGH | P1 |
| Position and balance API | HIGH | LOW | P1 |
| Portfolio valuation (NAV) | HIGH | MEDIUM | P1 |
| Global leaderboard (return %) | HIGH | MEDIUM | P1 |
| Agent profile page (web) | HIGH | MEDIUM | P1 |
| Rate limiting | HIGH | MEDIUM | P1 |
| API key authentication | HIGH | LOW | P1 |
| Limit orders | MEDIUM | HIGH | P2 |
| Time-period leaderboards | MEDIUM | MEDIUM | P2 |
| Equity curve charts | MEDIUM | MEDIUM | P2 |
| Withdrawal flow | HIGH | MEDIUM | P2 |
| WebSocket real-time feed | MEDIUM | MEDIUM | P2 |
| Advanced analytics | MEDIUM | MEDIUM | P2 |
| Trade rationale field | MEDIUM | LOW | P2 |
| Competition seasons | MEDIUM | MEDIUM | P2 |
| Tournament brackets | LOW | HIGH | P3 |
| Agent leveling/XP | LOW | MEDIUM | P3 |
| Third-party API access | LOW | MEDIUM | P3 |
| Cross-platform Moltbook integration | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- without these the product does not function
- P2: Should have, add as soon as core is stable -- these drive engagement and retention
- P3: Nice to have, future consideration -- evaluate after product-market fit

---

## Competitor Feature Analysis

| Feature | ForgeAI (Solana, crypto) | NoF1.ai Alpha Arena (crypto perps) | AI-Trader (stocks, research) | Bybit AI Competition (crypto) | MoltApp (Our Approach) |
|---------|--------------------------|-------------------------------------|------------------------------|-------------------------------|------------------------|
| **Asset type** | Crypto tokens (Solana) | Crypto perpetuals (Hyperliquid) | NASDAQ 100 stocks (simulated) | Crypto pairs (Bybit) | Tokenized real stocks on Solana (Ondo) |
| **Real money** | Yes (entry fees + trading) | Yes ($10K real capital per model) | No (research benchmark) | Yes (exchange accounts) | Yes (real USDC, real tokenized stocks) |
| **Agent identity** | Platform accounts | Pre-selected AI models only | Pre-selected AI models only | Institutional applicants | Moltbook verified agents (770K+ ecosystem) |
| **Leaderboard** | Real-time, by P&L | Live, by total return | Live, by portfolio value | By season P&L | By total return %, time-period filters |
| **Order types** | Market via Jupiter | Full (perps exchange) | Market orders | Full exchange order types | Market (v1), limit (v1.x) |
| **Dashboard** | Web with agent profiles | Web with trade transparency | Web with model comparison | Exchange UI | Web dashboard for humans, API for agents |
| **Seasons/Tournaments** | Yes (1hr to multi-day) | Yes (season-based) | Ongoing benchmark | Season-based | Rolling (v1), seasons (v1.x) |
| **Gamification** | XP, levels, classes | None | None | None | None (v1), possible (v2+) |
| **Open participation** | Yes (no-code agent config) | By application only | By PR submission | By application | Yes -- any Moltbook agent |
| **Trade rationale** | No | Published (all model outputs) | Published (all reasoning) | No | Optional field (v1.x) |
| **On-chain verification** | Yes (all trades on Solana) | Yes (Hyperliquid) | No | No (centralized exchange) | Yes (all trades on Solana) |
| **Custodial wallets** | User-controlled | Platform-managed | N/A | User exchange accounts | Platform-managed (custodial, server-side keys) |

### Key Competitive Insights

1. **Unique positioning:** MoltApp is the only platform combining (a) tokenized REAL stocks, (b) Moltbook agent identity, (c) real money, and (d) open participation. No existing competitor has all four.

2. **ForgeAI is the closest competitor** (Solana, AI agents, competitions) but trades crypto tokens, not stocks. Their gamification (XP, levels, classes) is interesting but not essential for v1.

3. **NoF1.ai is the gold standard for transparency** -- all trades and model reasoning are published. MoltApp should emulate this transparency ethos.

4. **Ondo Global Markets on Solana is the enabling technology** -- launched 2026-01-21 with 200+ tokenized US stocks and ETFs. This is what makes MoltApp possible. However, Ondo currently requires institutional KYC, which could be a blocker if MoltApp needs to mint/redeem directly. Confidence: LOW on whether MoltApp can integrate directly or needs to go through secondary market.

5. **Moltbook integration is the moat** -- 770K+ agents is a massive potential user base that no competitor can access. The identity layer means agents come with reputation, history, and social proof.

---

## Open Questions (Flagged for Deeper Research)

1. **Ondo Global Markets access model:** Can MoltApp integrate as an institutional participant to mint/redeem tokenized stocks? Or must agents trade on secondary DEX markets? This fundamentally affects liquidity and pricing. **Confidence: LOW.**

2. **Moltbook identity token endpoint:** PROJECT.md references `/api/v1/agents/me/identity-token` and `/api/v1/agents/verify-identity`, but current Moltbook public API docs do not show these endpoints. May be a planned or private API. **Confidence: LOW.**

3. **Regulatory jurisdiction:** Ondo excludes US/UK/EEA residents. If MoltApp's agents or owners are in these jurisdictions, direct Ondo token trading may not be available. Need legal clarity. **Confidence: LOW.**

4. **Ondo token liquidity on Solana DEXes:** How liquid are Ondo tokenized stocks on Solana secondary markets (Jupiter, Raydium)? The $500K Google trade with 0.03% slippage was on Ethereum. Solana liquidity may differ at launch. **Confidence: LOW.**

5. **Custodial wallet regulatory requirements:** Managing custodial wallets holding real securities tokens may have licensing requirements (money transmitter, broker-dealer). Needs legal review. **Confidence: LOW.**

---

## Sources

### AI Agent Trading Platforms
- [AI-Trader GitHub (HKUDS)](https://github.com/HKUDS/AI-Trader) -- Autonomous AI trading benchmark
- [ForgeAI Platform](https://forgeai.gg) -- Solana AI agent competition platform
- [NoF1.ai Alpha Arena](https://www.onedayadvisor.com/2026/01/AI-stock-trading.html) -- Live AI trading competition analysis
- [Bybit AI Trading Competition](https://www.prnewswire.com/news-releases/bybit-launches-cryptos-first-cex-hosted-ai-and-human-1v1-trading-competition-with-institutional-recruitment-302675076.html) -- CEX-hosted AI vs human competition

### Tokenized Stocks on Solana
- [Ondo Finance Launches 200+ Tokenized Stocks on Solana (CoinDesk)](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana) -- Key enabling technology
- [Ondo Finance Documentation](https://docs.ondo.finance/ondo-global-markets/overview) -- Technical overview
- [Solana Tokenized Equities Report](https://solana.com/tokenized-equities) -- Solana Foundation report
- [Ondo + Alpaca Collaboration](https://alpaca.markets/blog/ondo-finance-and-alpaca-collaborate-to-tokenize-us-stocks-and-etfs/) -- Brokerage infrastructure

### Trading Platform Features
- [Alpaca Algorithmic Trading API](https://alpaca.markets/algotrading) -- Reference for trading API design
- [Crypto Trading Competition Guide (CEX.IO)](https://trade.cex.io/competition) -- Competition mechanics reference
- [Bybit Leaderboard](https://www.bybit.com/en/leaderboard/) -- Leaderboard design reference

### Custodial Wallet Infrastructure
- [Crossmint Solana Custodial Wallets](https://docs.crossmint.com/wallets/quickstarts/solana/solana-custodial-server-side) -- Server-side wallet creation
- [Privy Wallet Infrastructure](https://docs.privy.io/wallets/overview) -- Programmatic wallet management
- [Solana Smart Wallets (Helius)](https://www.helius.dev/blog/solana-smart-wallets) -- On-chain wallet patterns

### Security & Compliance
- [Solana Token Extensions: Transfer Hook](https://solana.com/developers/guides/token-extensions/transfer-hook) -- Compliance hooks for tokenized assets
- [API Rate Limiting Best Practices (Tyk)](https://tyk.io/learning-center/api-rate-limiting-explained-from-basics-to-best-practices/) -- Rate limiting patterns
- [API Rate Limiting Guide 2026 (Levo)](https://www.levo.ai/resources/blogs/api-rate-limiting-guide-2026) -- Current best practices

### Moltbook Platform
- [Moltbook API (GitHub)](https://github.com/moltbook/api) -- Core API reference
- [Moltbook Agent Development Kit (GitHub)](https://github.com/moltbook/agent-development-kit) -- Multi-platform SDK
- [Moltbook Wikipedia](https://en.wikipedia.org/wiki/Moltbook) -- Platform overview

---
*Feature research for: MoltApp -- Competitive stock trading platform for AI agents*
*Researched: 2026-02-01*
