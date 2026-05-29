import { Hono } from "hono";
import { html } from "hono/html";

export const evarianDemoRoutes = new Hono();

evarianDemoRoutes.get("/", (c) => {
  const page = html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Evarian Demo</title>
  <meta
    name="description"
    content="Evarian AI travel execution demo with natural-language booking, USDC wallet authorization, and Solana-style proof."
  />
  <style>
    :root {
      color-scheme: light;
      --ink: #172022;
      --muted: #62706f;
      --line: rgba(23, 32, 34, 0.13);
      --panel: rgba(255, 255, 255, 0.9);
      --paper: #f7faf8;
      --mint: #1d9a74;
      --teal: #0c6f82;
      --charcoal: #101718;
      --shadow: 0 24px 80px rgba(16, 23, 24, 0.18);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 84% 18%, rgba(29, 154, 116, 0.18), transparent 28%),
        linear-gradient(135deg, rgba(247, 250, 248, 0.98), rgba(231, 241, 238, 0.94));
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input { font: inherit; }
    .shell { min-height: 100vh; padding: 28px; }
    .workspace {
      width: min(1260px, 100%);
      margin: 0 auto;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.72);
      background: rgba(247, 250, 248, 0.78);
      box-shadow: var(--shadow);
      backdrop-filter: blur(22px);
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 10px 8px 22px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      background: var(--charcoal);
      color: white;
      font-weight: 800;
    }
    .brand strong, .brand span { display: block; }
    .brand strong { font-size: 18px; }
    .brand span { color: var(--muted); font-size: 13px; }
    .network-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.74);
      padding: 9px 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--mint);
      box-shadow: 0 0 0 6px rgba(29, 154, 116, 0.13);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
      gap: 18px;
    }
    .agent-panel, .result-panel, .proof-panel {
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .agent-panel { padding: clamp(22px, 4vw, 42px); }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--teal);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 {
      max-width: 690px;
      font-size: clamp(36px, 5vw, 72px);
      line-height: 0.94;
    }
    h2 { font-size: clamp(24px, 3vw, 38px); line-height: 1; }
    .command-box {
      margin-top: 30px;
      padding: 14px;
      border: 1px solid var(--line);
      background: white;
    }
    .command-box label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .input-row { display: flex; gap: 10px; }
    .input-row input {
      min-width: 0;
      flex: 1;
      border: 1px solid var(--line);
      padding: 13px 14px;
      color: var(--ink);
      outline: none;
    }
    .input-row input:focus {
      border-color: rgba(12, 111, 130, 0.65);
      box-shadow: 0 0 0 3px rgba(12, 111, 130, 0.12);
    }
    button {
      border: 0;
      background: var(--charcoal);
      color: white;
      cursor: pointer;
      font-weight: 800;
    }
    .input-row button, #authorizeButton { padding: 0 18px; min-height: 48px; }
    button:hover { filter: brightness(1.08); }
    .context-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 16px;
    }
    .context-grid div, .route-summary div, .wallet-panel dl div {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
      padding: 12px;
    }
    .label, dt {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .value, dd {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 14px;
      font-weight: 800;
    }
    .timeline { display: grid; gap: 12px; margin-top: 26px; }
    .step {
      display: grid;
      grid-template-columns: 22px 1fr;
      gap: 12px;
      opacity: 0.52;
      transition: opacity 180ms ease, transform 180ms ease;
    }
    .dot {
      width: 12px;
      height: 12px;
      margin-top: 5px;
      border: 2px solid rgba(23, 32, 34, 0.25);
      border-radius: 999px;
      background: white;
    }
    .step strong, .step p { display: block; margin: 0; }
    .step strong { font-size: 15px; }
    .step p { margin-top: 3px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .step.active { opacity: 1; transform: translateX(3px); }
    .step.active .dot {
      border-color: var(--mint);
      background: var(--mint);
      box-shadow: 0 0 0 6px rgba(29, 154, 116, 0.12);
    }
    .result-panel { display: grid; gap: 14px; padding: 14px; }
    .route-card { overflow: hidden; border: 1px solid var(--line); background: white; }
    .route-map {
      position: relative;
      min-height: 290px;
      overflow: hidden;
      background:
        linear-gradient(140deg, rgba(255,255,255,0.8), rgba(255,255,255,0.18)),
        radial-gradient(circle at 18% 30%, rgba(255, 255, 255, 0.95), transparent 22%),
        linear-gradient(115deg, #dbe7e4 0%, #f2f5ef 42%, #b8cbc9 100%);
    }
    .route-map::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(120deg, transparent 0 37%, rgba(16, 23, 24, 0.16) 38% 40%, transparent 41%),
        linear-gradient(152deg, transparent 0 54%, rgba(12, 111, 130, 0.28) 55% 56%, transparent 57%);
    }
    .skyline {
      position: absolute;
      left: 32px;
      right: 170px;
      bottom: 62px;
      height: 72px;
      background:
        linear-gradient(to top, rgba(16, 23, 24, 0.48), rgba(16, 23, 24, 0.1)),
        repeating-linear-gradient(90deg, transparent 0 18px, rgba(16, 23, 24, 0.36) 18px 25px);
      clip-path: polygon(0 100%, 0 65%, 6% 65%, 6% 38%, 11% 38%, 11% 62%, 18% 62%, 18% 20%, 22% 20%, 22% 58%, 30% 58%, 30% 44%, 36% 44%, 36% 70%, 46% 70%, 46% 32%, 52% 32%, 52% 62%, 61% 62%, 61% 10%, 65% 10%, 65% 56%, 74% 56%, 74% 40%, 80% 40%, 80% 64%, 100% 64%, 100% 100%);
    }
    .terminal {
      position: absolute;
      right: 38px;
      bottom: 74px;
      width: 92px;
      height: 112px;
      border-radius: 46px 46px 10px 10px;
      background: linear-gradient(180deg, rgba(16,23,24,0.64), rgba(16,23,24,0.28));
    }
    .car {
      position: absolute;
      right: 72px;
      bottom: 36px;
      width: 160px;
      height: 54px;
      border-radius: 28px 44px 14px 14px;
      background: linear-gradient(180deg, #1a2325, #050707);
      box-shadow: 0 18px 30px rgba(16,23,24,0.22);
    }
    .car::before {
      content: "";
      position: absolute;
      left: 38px;
      top: -22px;
      width: 74px;
      height: 34px;
      border-radius: 34px 34px 4px 4px;
      background: linear-gradient(180deg, #253235, #0d1213);
    }
    .route-line {
      position: absolute;
      left: 54px;
      right: 78px;
      bottom: 82px;
      height: 4px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--teal), var(--mint), #fff);
      transform: rotate(-9deg);
      transform-origin: right center;
      box-shadow: 0 0 18px rgba(29, 154, 116, 0.5);
    }
    .wallet-glyph {
      position: absolute;
      right: 58px;
      top: 42px;
      border: 1px solid rgba(12, 111, 130, 0.26);
      background: rgba(255, 255, 255, 0.56);
      padding: 12px 14px;
      color: var(--teal);
      font-weight: 900;
    }
    .route-summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      padding: 10px;
    }
    .quote-list { display: grid; gap: 9px; }
    .quote {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.78);
      color: var(--ink);
      padding: 13px;
      text-align: left;
    }
    .quote.selected {
      border-color: rgba(12, 111, 130, 0.55);
      background: rgba(232, 246, 240, 0.94);
    }
    .quote span, .quote strong, .quote em, .quote b { display: block; }
    .quote em { margin-top: 3px; color: var(--muted); font-size: 12px; font-style: normal; font-weight: 500; }
    .quote b { white-space: nowrap; color: var(--teal); font-size: 14px; }
    .wallet-panel { border: 1px solid var(--line); background: #fff; padding: 14px; }
    .wallet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .wallet-panel dl {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 14px 0 0;
    }
    dt, dd { margin: 0; }
    .proof-panel {
      display: grid;
      grid-template-columns: minmax(0, 0.8fr) minmax(360px, 1.2fr);
      gap: 18px;
      margin-top: 18px;
      padding: 24px;
    }
    .proof-copy span { display: block; max-width: 560px; margin-top: 12px; color: var(--muted); line-height: 1.55; }
    .proof-terminal {
      display: grid;
      gap: 8px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: #0c1213;
      padding: 14px;
    }
    .proof-terminal div {
      display: grid;
      grid-template-columns: 130px 1fr;
      gap: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.09);
      padding: 8px 0;
    }
    .proof-terminal div:last-child { border-bottom: 0; }
    .proof-terminal .label { color: #8ca3a0; }
    .proof-terminal .value {
      margin: 0;
      overflow-wrap: anywhere;
      color: #e9f3ef;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 13px;
    }
    .authorized { background: var(--mint) !important; }
    @media (max-width: 980px) {
      .shell { padding: 14px; }
      .hero-grid, .proof-panel { grid-template-columns: 1fr; }
      .context-grid, .route-summary, .wallet-panel dl { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 620px) {
      .workspace { padding: 12px; }
      .topbar, .input-row, .wallet-head { align-items: stretch; flex-direction: column; }
      .context-grid, .route-summary, .wallet-panel dl { grid-template-columns: 1fr; }
      h1 { font-size: 40px; }
      .proof-terminal div { grid-template-columns: 1fr; gap: 3px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="workspace" aria-label="Evarian travel agent demo">
      <div class="topbar">
        <div class="brand">
          <span class="brand-mark">E</span>
          <div>
            <strong>Evarian</strong>
            <span>AI travel execution demo</span>
          </div>
        </div>
        <div class="network-pill"><span class="pulse"></span> Solana devnet simulation</div>
      </div>

      <section class="hero-grid">
        <div class="agent-panel">
          <p class="eyebrow">Natural-language booking</p>
          <h1>Get me to the airport tomorrow at 8 AM.</h1>
          <form id="commandForm" class="command-box">
            <label for="commandInput">Travel command</label>
            <div class="input-row">
              <input id="commandInput" value="Get me to SFO tomorrow at 8 AM in a black car" />
              <button type="submit">Run demo</button>
            </div>
          </form>
          <div class="context-grid" aria-label="User context">
            <div><span class="label">Location</span><strong class="value">San Francisco</strong></div>
            <div><span class="label">Preference</span><strong class="value">Upscale black cars</strong></div>
            <div><span class="label">Airport pattern</span><strong class="value">SFO Terminal 3</strong></div>
            <div><span class="label">Payment</span><strong class="value">USDC wallet</strong></div>
          </div>
          <div class="timeline" id="timeline" aria-live="polite">
            <div class="step active"><span class="dot"></span><div><strong>Reading user intent</strong><p>Understands airport transfer, departure time, and comfort preference.</p></div></div>
            <div class="step"><span class="dot"></span><div><strong>Applying memory</strong><p>Uses San Francisco home base, SFO Terminal 3, and black-car history.</p></div></div>
            <div class="step"><span class="dot"></span><div><strong>Comparing providers</strong><p>Ranks premium ride options by arrival buffer, cost, and reliability.</p></div></div>
            <div class="step"><span class="dot"></span><div><strong>Authorizing wallet</strong><p>Places a USDC hold with spend guardrails before booking execution.</p></div></div>
            <div class="step"><span class="dot"></span><div><strong>Writing blockchain proof</strong><p>Creates a Solana-style payment authorization record for auditability.</p></div></div>
          </div>
        </div>

        <aside class="result-panel">
          <div class="route-card">
            <div class="route-map" aria-label="San Francisco to SFO route visualization">
              <div class="skyline"></div><div class="terminal"></div><div class="route-line"></div><div class="car"></div><div class="wallet-glyph">USDC</div>
            </div>
            <div class="route-summary">
              <div><span class="label">Recommended ride</span><strong class="value" id="providerName">BlackLane Premium</strong></div>
              <div><span class="label">Pickup</span><strong class="value">6:55 AM</strong></div>
              <div><span class="label">Arrival buffer</span><strong class="value">42 min</strong></div>
            </div>
          </div>
          <div class="quote-list" id="quoteList">
            <button class="quote selected" type="button" data-provider="BlackLane Premium"><span><strong>BlackLane Premium</strong><em>Best fit for user preference</em></span><b>57.20 USDC</b></button>
            <button class="quote" type="button" data-provider="Uber Black"><span><strong>Uber Black</strong><em>Fastest pickup window</em></span><b>61.40 USDC</b></button>
            <button class="quote" type="button" data-provider="Waymo One"><span><strong>Waymo One</strong><em>Autonomous option, longer ETA</em></span><b>48.80 USDC</b></button>
          </div>
          <div class="wallet-panel">
            <div class="wallet-head">
              <div><span class="label">Wallet balance</span><strong class="value">248.63 USDC</strong></div>
              <button id="authorizeButton" type="button">Authorize booking</button>
            </div>
            <dl>
              <div><dt>Spend limit</dt><dd>250.00 USDC</dd></div>
              <div><dt>Hold amount</dt><dd id="holdAmount">57.20 USDC</dd></div>
              <div><dt>Network</dt><dd>Solana</dd></div>
            </dl>
          </div>
        </aside>
      </section>

      <section class="proof-panel">
        <div class="proof-copy">
          <p class="eyebrow">Blockchain-facing proof</p>
          <h2>Payment authorization, not speculation.</h2>
          <span>For a client demo, this shows the useful blockchain part: stable-value wallet authorization, transaction traceability, and audit evidence around the agent's decision.</span>
        </div>
        <div class="proof-terminal" id="proofTerminal">
          <div><span class="label">status</span><strong class="value">waiting_for_authorization</strong></div>
          <div><span class="label">wallet</span><strong class="value">EVAR...9K2P</strong></div>
          <div><span class="label">mint</span><strong class="value">USDC devnet</strong></div>
          <div><span class="label">memo</span><strong class="value">SFO transfer, Terminal 3, black car</strong></div>
          <div><span class="label">signature</span><strong class="value">pending</strong></div>
        </div>
      </section>
    </section>
  </main>
  <script>
    const timeline = Array.from(document.querySelectorAll(".step"));
    const form = document.querySelector("#commandForm");
    const input = document.querySelector("#commandInput");
    const authorizeButton = document.querySelector("#authorizeButton");
    const proofTerminal = document.querySelector("#proofTerminal");
    const quoteButtons = Array.from(document.querySelectorAll(".quote"));
    const providerName = document.querySelector("#providerName");
    const holdAmount = document.querySelector("#holdAmount");
    const quoteAmounts = { "BlackLane Premium": "57.20 USDC", "Uber Black": "61.40 USDC", "Waymo One": "48.80 USDC" };
    let selectedProvider = "BlackLane Premium";
    function setActiveStep(index) {
      timeline.forEach((step, stepIndex) => step.classList.toggle("active", stepIndex <= index));
    }
    function signatureFor(command) {
      const cleaned = command.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
      return \`5eVar\${cleaned || "airport"}9k2pUSDCx7mQ4bP1sFo\`;
    }
    function setProof(status, signature = "pending") {
      proofTerminal.innerHTML = \`
        <div><span class="label">status</span><strong class="value">\${status}</strong></div>
        <div><span class="label">wallet</span><strong class="value">EVAR...9K2P</strong></div>
        <div><span class="label">mint</span><strong class="value">USDC devnet</strong></div>
        <div><span class="label">provider</span><strong class="value">\${selectedProvider}</strong></div>
        <div><span class="label">memo</span><strong class="value">SFO transfer, Terminal 3, black car</strong></div>
        <div><span class="label">signature</span><strong class="value">\${signature}</strong></div>
      \`;
    }
    function runDemo() {
      authorizeButton.classList.remove("authorized");
      authorizeButton.textContent = "Authorize booking";
      setProof("analyzing_intent");
      setActiveStep(0);
      [[1, "loading_user_memory"], [2, "ranking_provider_quotes"], [3, "wallet_hold_ready"], [4, "proof_ready_for_signature"]].forEach(([index, status], stepIndex) => {
        window.setTimeout(() => { setActiveStep(index); setProof(status); }, 650 * (stepIndex + 1));
      });
    }
    quoteButtons.forEach((button) => {
      button.addEventListener("click", () => {
        quoteButtons.forEach((quote) => quote.classList.remove("selected"));
        button.classList.add("selected");
        selectedProvider = button.dataset.provider || selectedProvider;
        providerName.textContent = selectedProvider;
        holdAmount.textContent = quoteAmounts[selectedProvider];
        setProof("provider_selected");
      });
    });
    form.addEventListener("submit", (event) => { event.preventDefault(); runDemo(); });
    authorizeButton.addEventListener("click", () => {
      authorizeButton.classList.add("authorized");
      authorizeButton.textContent = "Authorized";
      setActiveStep(4);
      setProof("confirmed_on_solana_devnet", signatureFor(input.value));
    });
    window.setTimeout(runDemo, 450);
  </script>
</body>
</html>`;

  return c.html(page);
});
