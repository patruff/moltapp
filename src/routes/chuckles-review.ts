import { Hono, type Context } from "hono";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { createRepo, uploadFile, type RepoId } from "@huggingface/hub";
import { env } from "../config/env.ts";

type Choice = "A" | "B";

type CandidatePair = {
  input: string;
  outputA: string;
  outputB: string;
  modelA?: string;
  modelB?: string;
  sourceDataset?: string;
  notes?: string;
};

type PreferenceJudgment = CandidatePair & {
  id: string;
  choice: Choice;
  chosen: string;
  rejected: string;
  chosenModel: string;
  rejectedModel: string;
  judgedBy: string;
  judgedAt: string;
  source: string;
};

const chucklesReviewRoutes = new Hono();

const DEFAULT_CHUCKLES_HF_REPO = "patruff/chuckles-human-preferences";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

let dynamoClient: DynamoDBClient | null = null;

function getDynamoClient(): DynamoDBClient {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({});
  }
  return dynamoClient;
}

function getPreferenceTableName(): string {
  return process.env.CHUCKLES_PREFERENCE_TABLE ?? "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function getSessionSecret(): string {
  return (
    env.CHUCKLES_SESSION_SECRET ??
    env.CHUCKLES_REVIEW_PASSWORD_HASH ??
    "local-chuckles-review-session-secret"
  );
}

function signSession(username: string): string {
  const payload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", getSessionSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySessionToken(token: string | null): string | null {
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = createHmac("sha256", getSessionSecret())
    .update(encoded)
    .digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

async function requireChucklesAuth(c: Context) {
  const user = verifySessionToken(bearerToken(c.req.header("Authorization")));
  if (!user) {
    return { user: null, response: c.json({ error: "unauthorized" }, 401) };
  }
  return { user, response: null };
}

function normalizeCandidate(body: unknown): CandidatePair | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const input = typeof data.input === "string" ? data.input.trim() : "";
  const outputA = typeof data.outputA === "string" ? data.outputA.trim() : "";
  const outputB = typeof data.outputB === "string" ? data.outputB.trim() : "";
  if (!input || !outputA || !outputB) return null;
  return {
    input,
    outputA,
    outputB,
    modelA: typeof data.modelA === "string" ? data.modelA.trim() : "model_a",
    modelB: typeof data.modelB === "string" ? data.modelB.trim() : "model_b",
    sourceDataset:
      typeof data.sourceDataset === "string" ? data.sourceDataset.trim() : "manual_batch",
    notes: typeof data.notes === "string" ? data.notes.trim() : "",
  };
}

function judgmentToItem(judgment: PreferenceJudgment): Record<string, AttributeValue> {
  return {
    pk: { S: "JUDGMENT" },
    sk: { S: `${judgment.judgedAt}#${judgment.id}` },
    id: { S: judgment.id },
    input: { S: judgment.input },
    outputA: { S: judgment.outputA },
    outputB: { S: judgment.outputB },
    modelA: { S: judgment.modelA ?? "model_a" },
    modelB: { S: judgment.modelB ?? "model_b" },
    choice: { S: judgment.choice },
    chosen: { S: judgment.chosen },
    rejected: { S: judgment.rejected },
    chosenModel: { S: judgment.chosenModel },
    rejectedModel: { S: judgment.rejectedModel },
    judgedBy: { S: judgment.judgedBy },
    judgedAt: { S: judgment.judgedAt },
    source: { S: judgment.source },
    sourceDataset: { S: judgment.sourceDataset ?? "manual_batch" },
    notes: { S: judgment.notes ?? "" },
    dpo: { S: JSON.stringify(judgmentToDpo(judgment)) },
  };
}

function itemToJudgment(item: Record<string, AttributeValue>): PreferenceJudgment | null {
  const id = item.id?.S;
  const input = item.input?.S;
  const outputA = item.outputA?.S;
  const outputB = item.outputB?.S;
  const choice = item.choice?.S as Choice | undefined;
  const chosen = item.chosen?.S;
  const rejected = item.rejected?.S;
  const judgedBy = item.judgedBy?.S;
  const judgedAt = item.judgedAt?.S;
  if (!id || !input || !outputA || !outputB || !choice || !chosen || !rejected || !judgedBy || !judgedAt) {
    return null;
  }
  return {
    id,
    input,
    outputA,
    outputB,
    choice,
    chosen,
    rejected,
    modelA: item.modelA?.S ?? "model_a",
    modelB: item.modelB?.S ?? "model_b",
    chosenModel: item.chosenModel?.S ?? "unknown",
    rejectedModel: item.rejectedModel?.S ?? "unknown",
    judgedBy,
    judgedAt,
    source: item.source?.S ?? "chuckles-review-app",
    sourceDataset: item.sourceDataset?.S ?? "manual_batch",
    notes: item.notes?.S ?? "",
  };
}

function judgmentToDpo(judgment: PreferenceJudgment): Record<string, unknown> {
  return {
    prompt: `Create a funny parody title or phrase for this input:\n${judgment.input}`,
    chosen: judgment.chosen,
    rejected: judgment.rejected,
    input_text: judgment.input,
    chosen_model: judgment.chosenModel,
    rejected_model: judgment.rejectedModel,
    source_dataset: judgment.sourceDataset ?? "manual_batch",
    judged_by: judgment.judgedBy,
    judged_at: judgment.judgedAt,
    source: judgment.source,
  };
}

async function persistJudgment(judgment: PreferenceJudgment): Promise<void> {
  const tableName = getPreferenceTableName();
  if (!tableName) {
    throw new Error("CHUCKLES_PREFERENCE_TABLE is not configured");
  }
  await getDynamoClient().send(
    new PutItemCommand({
      TableName: tableName,
      Item: judgmentToItem(judgment),
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }),
  );
}

async function listJudgments(limit = 100): Promise<PreferenceJudgment[]> {
  const tableName = getPreferenceTableName();
  if (!tableName) return [];

  const result = await getDynamoClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: "JUDGMENT" },
      },
      ScanIndexForward: false,
      Limit: Math.min(Math.max(limit, 1), 500),
    }),
  );

  return (result.Items ?? [])
    .map((item) => itemToJudgment(item))
    .filter((item): item is PreferenceJudgment => Boolean(item));
}

async function countJudgments(): Promise<number> {
  const tableName = getPreferenceTableName();
  if (!tableName) return 0;
  const result = await getDynamoClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: "JUDGMENT" },
      },
      Select: "COUNT",
    }),
  );
  return result.Count ?? 0;
}

function currentExportFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
  ].join("_") + "_" + pad(now.getUTCHours()) + pad(now.getUTCMinutes());
  return `exports/${stamp}_preference.jsonl`;
}

function getHuggingFaceToken(): string {
  return (
    env.CHUCKLES_HF_TOKEN ??
    env.HF_TOKEN ??
    env.HUGGINGFACE_TOKEN ??
    ""
  ).trim();
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeStatus = (error as { statusCode?: number; status?: number }).statusCode ??
    (error as { statusCode?: number; status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  return maybeStatus === 409 || /already exists|conflict/i.test(message);
}

async function uploadPreferenceJsonl(params: {
  repoName: string;
  filename: string;
  jsonl: string;
  count: number;
}): Promise<string> {
  const token = getHuggingFaceToken();
  if (!token) {
    throw new Error("Set CHUCKLES_HF_TOKEN, HF_TOKEN, or HUGGINGFACE_TOKEN in moltapp/production.");
  }

  const repo: RepoId = { type: "dataset", name: params.repoName };
  try {
    await createRepo({
      accessToken: token,
      repo,
      private: true,
      files: [
        {
          path: "README.md",
          content: new TextEncoder().encode(
            [
              "---",
              "license: other",
              "task_categories:",
              "- text-generation",
              "language:",
              "- en",
              "---",
              "",
              "# Chuckles Human Preference Dataset",
              "",
              "Human-judged parody preference data exported from patgpt.us.",
              "Each JSONL row contains `prompt`, `chosen`, and `rejected` columns for DPO training.",
              "",
            ].join("\n"),
          ).buffer,
        },
      ],
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  await uploadFile({
    accessToken: token,
    repo,
    file: {
      path: params.filename,
      content: new Blob([params.jsonl], { type: "application/jsonl" }),
    },
    commitTitle: `Add ${params.count} Chuckles preference judgments`,
    commitDescription: "Exported from the patgpt.us Chuckles human review app.",
  });

  return `https://huggingface.co/datasets/${params.repoName}/blob/main/${params.filename}`;
}

chucklesReviewRoutes.get("/", (c) => c.html(CHUCKLES_REVIEW_HTML));
chucklesReviewRoutes.get("/chuckles", (c) => c.html(CHUCKLES_REVIEW_HTML));

chucklesReviewRoutes.post("/api/v1/chuckles/login", async (c) => {
  const body = await c.req.json().catch(() => null) as { username?: string; password?: string } | null;
  const username = body?.username?.trim() ?? "";
  const password = body?.password ?? "";
  const configuredUser = env.CHUCKLES_REVIEW_USERNAME;
  const configuredHash = env.CHUCKLES_REVIEW_PASSWORD_HASH ?? "";

  if (!configuredHash) {
    return c.json({
      error: "login_not_configured",
      message: "Set CHUCKLES_REVIEW_PASSWORD_HASH in moltapp/production.",
    }, 503);
  }

  if (username !== configuredUser || !safeEqual(sha256(password), configuredHash)) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  return c.json({
    token: signSession(username),
    username,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
});

chucklesReviewRoutes.get("/api/v1/chuckles/datasets", async (c) => {
  const auth = await requireChucklesAuth(c);
  if (auth.response) return auth.response;

  const totalPreferences = await countJudgments().catch(() => 0);
  const recent = await listJudgments(8).catch(() => []);
  const repoName = env.CHUCKLES_HF_REPO || DEFAULT_CHUCKLES_HF_REPO;
  return c.json({
    datasets: [
      {
        id: "manual-review-queue",
        name: "Manual Review Queue",
        kind: "browser_loaded_candidates",
        description: "Paste raw candidate pairs into the app, then judge side by side.",
      },
      {
        id: "human-preferences",
        name: "Human Preference Judgments",
        kind: "dynamodb",
        description: "Durable accepted A/B preferences that can be exported for DPO.",
        count: totalPreferences,
        tableConfigured: Boolean(getPreferenceTableName()),
      },
      {
        id: "huggingface-export",
        name: repoName,
        kind: "huggingface_dataset",
        description: "Target dataset repo for timestamped DPO JSONL exports.",
        url: `https://huggingface.co/datasets/${repoName}`,
        tokenConfigured: Boolean(getHuggingFaceToken()),
      },
    ],
    recentJudgments: recent,
  });
});

chucklesReviewRoutes.get("/api/v1/chuckles/judgments", async (c) => {
  const auth = await requireChucklesAuth(c);
  if (auth.response) return auth.response;
  const limit = Number(c.req.query("limit") ?? "100");
  return c.json({ judgments: await listJudgments(limit) });
});

chucklesReviewRoutes.post("/api/v1/chuckles/judgments", async (c) => {
  const auth = await requireChucklesAuth(c);
  if (auth.response) return auth.response;

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const candidate = normalizeCandidate(body);
  const choice = body?.choice === "A" || body?.choice === "B" ? body.choice : null;
  if (!candidate || !choice) {
    return c.json({
      error: "invalid_judgment",
      message: "Provide input, outputA, outputB, and choice A or B.",
    }, 400);
  }

  const judgedAt = new Date().toISOString();
  const chosen = choice === "A" ? candidate.outputA : candidate.outputB;
  const rejected = choice === "A" ? candidate.outputB : candidate.outputA;
  const chosenModel = choice === "A" ? candidate.modelA ?? "model_a" : candidate.modelB ?? "model_b";
  const rejectedModel = choice === "A" ? candidate.modelB ?? "model_b" : candidate.modelA ?? "model_a";
  const judgment: PreferenceJudgment = {
    ...candidate,
    id: randomUUID(),
    choice,
    chosen,
    rejected,
    chosenModel,
    rejectedModel,
    judgedBy: auth.user ?? env.CHUCKLES_REVIEW_USERNAME,
    judgedAt,
    source: "chuckles-review-app",
  };

  await persistJudgment(judgment);
  return c.json({
    ok: true,
    judgment,
    dpo: judgmentToDpo(judgment),
  });
});

chucklesReviewRoutes.post("/api/v1/chuckles/export", async (c) => {
  const auth = await requireChucklesAuth(c);
  if (auth.response) return auth.response;

  const body = await c.req.json().catch(() => ({})) as { repo?: string; limit?: number };
  const judgments = await listJudgments(body.limit ?? 500);
  if (judgments.length === 0) {
    return c.json({ error: "no_judgments", message: "Judge at least one pair before exporting." }, 400);
  }

  const jsonl = judgments
    .map((judgment) => JSON.stringify(judgmentToDpo(judgment)))
    .join("\n") + "\n";
  const filename = currentExportFilename();
  const repoName = body.repo?.trim() || env.CHUCKLES_HF_REPO || DEFAULT_CHUCKLES_HF_REPO;

  try {
    const url = await uploadPreferenceJsonl({
      repoName,
      filename,
      jsonl,
      count: judgments.length,
    });
    return c.json({
      ok: true,
      repo: repoName,
      filename,
      count: judgments.length,
      url,
    });
  } catch (error) {
    return c.json({
      error: "huggingface_export_failed",
      message: error instanceof Error ? error.message : String(error),
      filename,
      count: judgments.length,
      jsonlPreview: jsonl.split("\n").slice(0, 3).join("\n"),
    }, 502);
  }
});

const CHUCKLES_REVIEW_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chuckles Preference Lab</title>
  <style>
    :root {
      --bg: #09090b;
      --panel: #121217;
      --panel-2: #191922;
      --line: #2c2c35;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --accent: #a3e635;
      --accent-2: #38bdf8;
      --warn: #f59e0b;
      --bad: #f87171;
      --good: #4ade80;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 15% 0%, rgba(163,230,53,0.12), transparent 30%),
        radial-gradient(circle at 85% 10%, rgba(56,189,248,0.10), transparent 30%),
        var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
    }
    button, input, textarea, select { font: inherit; }
    .shell { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 26px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .mark { width: 42px; height: 42px; border-radius: 10px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #050505; display: grid; place-items: center; font-weight: 900; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 48px); letter-spacing: 0; }
    .subtitle { color: var(--muted); margin-top: 4px; }
    .pill { border: 1px solid var(--line); background: rgba(255,255,255,0.03); color: var(--muted); border-radius: 999px; padding: 8px 12px; font-size: 13px; }
    .panel { background: rgba(18,18,23,0.92); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 24px 80px rgba(0,0,0,0.34); }
    .login { min-height: 62vh; display: grid; place-items: center; }
    .login-card { width: min(440px, 100%); padding: 28px; }
    .login-card h2, .section-title { margin: 0 0 6px; font-size: 18px; }
    .muted { color: var(--muted); }
    label { display: block; color: var(--muted); font-size: 13px; margin: 18px 0 8px; }
    input, textarea, select {
      width: 100%;
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 13px;
      outline: none;
    }
    textarea { min-height: 210px; resize: vertical; line-height: 1.45; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    input:focus, textarea:focus { border-color: rgba(163,230,53,0.65); box-shadow: 0 0 0 3px rgba(163,230,53,0.10); }
    .btn {
      border: 0;
      border-radius: 8px;
      padding: 12px 16px;
      cursor: pointer;
      background: var(--accent);
      color: #080808;
      font-weight: 800;
    }
    .btn.secondary { background: transparent; color: var(--text); border: 1px solid var(--line); }
    .btn.blue { background: var(--accent-2); }
    .btn.warn { background: var(--warn); }
    .btn.ghost { background: rgba(255,255,255,0.04); color: var(--muted); border: 1px solid var(--line); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: 330px 1fr; gap: 18px; align-items: start; }
    .stack { display: grid; gap: 14px; }
    .card { padding: 18px; }
    .dataset { display: grid; gap: 4px; border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
    .dataset:first-of-type { border-top: 0; padding-top: 0; }
    .dataset strong { font-size: 14px; }
    .dataset small { color: var(--muted); line-height: 1.4; }
    .review-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 14px; }
    .prompt { padding: 18px; background: #0f172a; border: 1px solid rgba(56,189,248,0.28); border-radius: 10px; margin-bottom: 16px; }
    .outputs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .output-card { min-height: 240px; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; background: #101014; border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
    .output-card h3 { margin: 0; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; }
    .output-text { white-space: pre-wrap; font-size: 18px; line-height: 1.45; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; }
    .status { min-height: 20px; color: var(--muted); font-size: 13px; }
    .status.good { color: var(--good); }
    .status.bad { color: var(--bad); }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; background: #07070a; border: 1px solid var(--line); border-radius: 8px; padding: 12px; color: #d4d4d8; max-height: 230px; overflow: auto; }
    .hidden { display: none !important; }
    @media (max-width: 900px) {
      .grid, .outputs, .split { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar">
      <div class="brand">
        <div class="mark">C</div>
        <div>
          <h1>Chuckles Preference Lab</h1>
          <div class="subtitle">Judge parody outputs, build DPO data, export to Hugging Face.</div>
        </div>
      </div>
      <div class="toolbar">
        <span id="session-pill" class="pill">Not signed in</span>
        <button id="logout-btn" class="btn ghost hidden">Log out</button>
      </div>
    </div>

    <section id="login-section" class="login panel">
      <div class="login-card">
        <h2>Private review app</h2>
        <p class="muted">Sign in to review Chuckles candidate outputs and create human preference rows.</p>
        <label for="username">Username</label>
        <input id="username" autocomplete="username" placeholder="username">
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" placeholder="password">
        <div class="toolbar" style="margin-top:18px">
          <button id="login-btn" class="btn">Log in</button>
        </div>
        <div id="login-status" class="status" style="margin-top:14px"></div>
      </div>
    </section>

    <section id="app-section" class="hidden">
      <div class="grid">
        <aside class="stack">
          <div class="panel card">
            <h2 class="section-title">Datasets</h2>
            <p class="muted">Current Chuckles review sources and export target.</p>
            <div id="datasets"></div>
          </div>
          <div class="panel card">
            <h2 class="section-title">Load candidates</h2>
            <p class="muted">Paste JSON or JSONL rows with input, outputA, and outputB.</p>
            <label for="candidate-input">Candidate pairs</label>
            <textarea id="candidate-input"></textarea>
            <div class="toolbar" style="margin-top:12px">
              <button id="load-btn" class="btn">Load batch</button>
              <button id="sample-btn" class="btn secondary">Use sample</button>
            </div>
            <div id="load-status" class="status" style="margin-top:10px"></div>
          </div>
        </aside>

        <section class="stack">
          <div class="panel card">
            <div class="review-head">
              <div>
                <h2 class="section-title">Side-by-side review</h2>
                <div id="queue-status" class="muted">No candidates loaded yet.</div>
              </div>
              <div class="toolbar">
                <button id="prev-btn" class="btn secondary">Previous</button>
                <button id="skip-btn" class="btn ghost">Skip</button>
                <button id="next-btn" class="btn secondary">Next</button>
              </div>
            </div>
            <div id="review-empty" class="prompt muted">Load a candidate batch to start judging.</div>
            <div id="review-panel" class="hidden">
              <div class="prompt">
                <strong>Input</strong>
                <div id="prompt-text" style="margin-top:8px"></div>
              </div>
              <div class="outputs">
                <div class="output-card">
                  <div>
                    <h3 id="model-a">Output A</h3>
                    <div id="output-a" class="output-text"></div>
                  </div>
                  <button id="choose-a-btn" class="btn">Choose A</button>
                </div>
                <div class="output-card">
                  <div>
                    <h3 id="model-b">Output B</h3>
                    <div id="output-b" class="output-text"></div>
                  </div>
                  <button id="choose-b-btn" class="btn blue">Choose B</button>
                </div>
              </div>
            </div>
            <div id="judge-status" class="status" style="margin-top:12px"></div>
          </div>

          <div class="split">
            <div class="panel card">
              <h2 class="section-title">Export DPO dataset</h2>
              <p class="muted">Exports the latest judged pairs as JSONL with prompt/chosen/rejected columns.</p>
              <label for="hf-repo">Hugging Face dataset repo</label>
              <input id="hf-repo" placeholder="patruff/chuckles-human-preferences">
              <div class="toolbar" style="margin-top:12px">
                <button id="export-btn" class="btn warn">Export to Hugging Face</button>
                <button id="refresh-btn" class="btn secondary">Refresh</button>
              </div>
              <div id="export-status" class="status" style="margin-top:10px"></div>
            </div>
            <div class="panel card">
              <h2 class="section-title">Recent judgments</h2>
              <pre id="recent-log">[]</pre>
            </div>
          </div>
        </section>
      </div>
    </section>
  </main>

  <script>
    const state = { token: localStorage.getItem("chuckles_token") || "", username: "", candidates: [], index: 0 };
    const sampleCandidates = [
      { input: "The Godfather", outputA: "The Codfather", outputB: "The Oddfather", modelA: "baseline", modelB: "candidate", sourceDataset: "sample" },
      { input: "Star Wars", outputA: "Scar Wars", outputB: "Star Roars", modelA: "baseline", modelB: "candidate", sourceDataset: "sample" },
      { input: "Jurassic Park", outputA: "Jurassic Pork", outputB: "Jurassic Bark", modelA: "baseline", modelB: "candidate", sourceDataset: "sample" }
    ];

    const $ = (id) => document.getElementById(id);

    function setStatus(id, text, cls) {
      const el = $(id);
      el.textContent = text || "";
      el.className = "status" + (cls ? " " + cls : "");
    }

    function authHeaders() {
      return state.token ? { Authorization: "Bearer " + state.token } : {};
    }

    async function api(path, options) {
      const res = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
          ...(options && options.headers ? options.headers : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Request failed");
      }
      return data;
    }

    function showApp() {
      $("login-section").classList.add("hidden");
      $("app-section").classList.remove("hidden");
      $("logout-btn").classList.remove("hidden");
      $("session-pill").textContent = state.username ? "Signed in as " + state.username : "Signed in";
      refreshDatasets();
      renderReview();
    }

    function showLogin() {
      $("login-section").classList.remove("hidden");
      $("app-section").classList.add("hidden");
      $("logout-btn").classList.add("hidden");
      $("session-pill").textContent = "Not signed in";
    }

    async function login() {
      setStatus("login-status", "Signing in...");
      try {
        const data = await api("/api/v1/chuckles/login", {
          method: "POST",
          body: JSON.stringify({ username: $("username").value, password: $("password").value })
        });
        state.token = data.token;
        state.username = data.username;
        localStorage.setItem("chuckles_token", state.token);
        setStatus("login-status", "");
        showApp();
      } catch (error) {
        setStatus("login-status", error.message, "bad");
      }
    }

    function logout() {
      state.token = "";
      localStorage.removeItem("chuckles_token");
      showLogin();
    }

    function parseCandidates(raw) {
      const text = raw.trim();
      if (!text) return [];
      let rows;
      if (text.startsWith("[")) {
        rows = JSON.parse(text);
      } else {
        rows = text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
      }
      if (!Array.isArray(rows)) throw new Error("Expected a JSON array or JSONL rows.");
      return rows.map((row) => ({
        input: String(row.input || "").trim(),
        outputA: String(row.outputA || row.output_a || "").trim(),
        outputB: String(row.outputB || row.output_b || "").trim(),
        modelA: String(row.modelA || row.model_a || "model_a"),
        modelB: String(row.modelB || row.model_b || "model_b"),
        sourceDataset: String(row.sourceDataset || row.source_dataset || "manual_batch"),
        notes: String(row.notes || "")
      })).filter((row) => row.input && row.outputA && row.outputB);
    }

    function loadCandidates(raw) {
      try {
        state.candidates = parseCandidates(raw);
        state.index = 0;
        setStatus("load-status", "Loaded " + state.candidates.length + " review pairs.", "good");
        renderReview();
      } catch (error) {
        setStatus("load-status", error.message, "bad");
      }
    }

    function renderReview() {
      const total = state.candidates.length;
      $("queue-status").textContent = total ? "Pair " + (state.index + 1) + " of " + total : "No candidates loaded yet.";
      $("prev-btn").disabled = total === 0 || state.index === 0;
      $("next-btn").disabled = total === 0 || state.index >= total - 1;
      $("skip-btn").disabled = total === 0;
      if (!total) {
        $("review-empty").classList.remove("hidden");
        $("review-panel").classList.add("hidden");
        return;
      }
      const item = state.candidates[state.index];
      $("review-empty").classList.add("hidden");
      $("review-panel").classList.remove("hidden");
      $("prompt-text").textContent = item.input;
      $("output-a").textContent = item.outputA;
      $("output-b").textContent = item.outputB;
      $("model-a").textContent = "Output A - " + (item.modelA || "model_a");
      $("model-b").textContent = "Output B - " + (item.modelB || "model_b");
    }

    function move(delta) {
      if (!state.candidates.length) return;
      state.index = Math.max(0, Math.min(state.candidates.length - 1, state.index + delta));
      setStatus("judge-status", "");
      renderReview();
    }

    async function choose(choice) {
      if (!state.candidates.length) return;
      const item = state.candidates[state.index];
      setStatus("judge-status", "Saving preference...");
      try {
        await api("/api/v1/chuckles/judgments", {
          method: "POST",
          body: JSON.stringify({ ...item, choice })
        });
        setStatus("judge-status", "Saved preference. This row is now eligible for DPO export.", "good");
        if (state.index < state.candidates.length - 1) state.index += 1;
        renderReview();
        refreshDatasets();
      } catch (error) {
        setStatus("judge-status", error.message, "bad");
      }
    }

    async function refreshDatasets() {
      try {
        const data = await api("/api/v1/chuckles/datasets", { method: "GET" });
        $("datasets").innerHTML = data.datasets.map((dataset) =>
          '<div class="dataset"><strong>' + dataset.name + '</strong><small>' +
          dataset.kind + (dataset.count !== undefined ? " - " + dataset.count + " rows" : "") +
          '</small><small>' + dataset.description + '</small></div>'
        ).join("");
        const hf = data.datasets.find((dataset) => dataset.kind === "huggingface_dataset");
        if (hf && !$("hf-repo").value) $("hf-repo").value = hf.name;
        $("recent-log").textContent = JSON.stringify(data.recentJudgments || [], null, 2);
      } catch (error) {
        if (state.token) setStatus("export-status", error.message, "bad");
      }
    }

    async function exportDataset() {
      setStatus("export-status", "Exporting preference JSONL...");
      try {
        const data = await api("/api/v1/chuckles/export", {
          method: "POST",
          body: JSON.stringify({ repo: $("hf-repo").value })
        });
        setStatus("export-status", "Exported " + data.count + " rows to " + data.filename, "good");
        window.open(data.url, "_blank");
      } catch (error) {
        setStatus("export-status", error.message, "bad");
      }
    }

    $("login-btn").addEventListener("click", login);
    $("password").addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
    $("logout-btn").addEventListener("click", logout);
    $("load-btn").addEventListener("click", () => loadCandidates($("candidate-input").value));
    $("sample-btn").addEventListener("click", () => {
      $("candidate-input").value = JSON.stringify(sampleCandidates, null, 2);
      loadCandidates($("candidate-input").value);
    });
    $("prev-btn").addEventListener("click", () => move(-1));
    $("next-btn").addEventListener("click", () => move(1));
    $("skip-btn").addEventListener("click", () => move(1));
    $("choose-a-btn").addEventListener("click", () => choose("A"));
    $("choose-b-btn").addEventListener("click", () => choose("B"));
    $("refresh-btn").addEventListener("click", refreshDatasets);
    $("export-btn").addEventListener("click", exportDataset);

    $("candidate-input").value = JSON.stringify(sampleCandidates, null, 2);
    if (state.token) showApp(); else showLogin();
  </script>
</body>
</html>`;

export { chucklesReviewRoutes };
