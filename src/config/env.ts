import { z } from "zod";

const envSchema = z.object({
  // Required in development, optional in Lambda (loaded from Secrets Manager)
  DATABASE_URL: z.string().default(""),
  MOLTBOOK_APP_KEY: z.string().default(""),
  JUPITER_API_KEY: z.string().default(""),
  ADMIN_PASSWORD: z.string().default(""),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Demo mode (for hackathon judges to try without real funds)
  DEMO_MODE: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true"),

  // AI Agent API keys (optional — agents degrade gracefully if missing)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),

  // Monad / $STONKS lending layer
  MONAD_RPC_URL: z.string().optional(),
  STONKS_TOKEN_ADDRESS: z.string().optional(),
  MONAD_DEPLOYER_PRIVATE_KEY: z.string().optional(),
  CLAUDE_MONAD_PRIVATE_KEY: z.string().optional(),
  GPT_MONAD_PRIVATE_KEY: z.string().optional(),
  GROK_MONAD_PRIVATE_KEY: z.string().optional(),
  LENDING_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true"),

  // Brave Search for real market research
  BRAVE_API_KEY: z.string().optional(),

  // Alpha Vantage for free news + sentiment
  ALPHA_VANTAGE_API_KEY: z.string().optional(),

  // Future (optional for now)
  TURNKEY_API_PRIVATE_KEY: z.string().optional(),
  TURNKEY_API_PUBLIC_KEY: z.string().optional(),
  TURNKEY_ORGANIZATION_ID: z.string().optional(),
  SOLANA_RPC_URL: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fetch secrets from AWS Secrets Manager and merge into process.env.
 * Only runs when deployed as a Lambda function (detected via AWS_LAMBDA_FUNCTION_NAME).
 * Locally, this is a no-op.
 */
async function loadSecretsFromAWS(): Promise<void> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }

  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    "@aws-sdk/client-secrets-manager"
  );

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({
    SecretId: process.env.SECRET_ARN,
  });

  const response = await client.send(command);

  if (response.SecretString) {
    try {
      const secrets = JSON.parse(response.SecretString) as Record<
        string,
        string
      >;
      for (const [key, value] of Object.entries(secrets)) {
        process.env[key] = value;
      }
    } catch {
      console.warn(
        "SECRET_ARN secret is not valid JSON — skipping secret injection. " +
          "Populate moltapp/production with a JSON object of key-value pairs.",
      );
    }
  }
}

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  return result.data;
}

// In Lambda: fetch secrets first, then validate. Locally: no-op, then validate.
await loadSecretsFromAWS();

export const env = loadEnv();
