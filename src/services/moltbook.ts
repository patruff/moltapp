import { env } from "../config/env.ts";

/** Shape of an agent returned by the Moltbook verify-identity endpoint */
export interface MoltbookAgent {
  id: string;
  name: string;
  description: string;
  karma: number;
  avatar_url: string;
  created_at: string;
  is_claimed: boolean;
  follower_count: number;
  following_count: number;
  stats: {
    posts: number;
    comments: number;
  };
  owner: {
    x_handle: string;
    x_name: string;
    x_avatar: string;
    x_verified: boolean;
    x_follower_count: number;
  };
}

/**
 * Verify a Moltbook identity token via server-to-server call.
 *
 * This should be called ONCE during agent registration, not on every request.
 * Moltbook rate-limits verification to 100 req/min per app.
 */
export async function verifyIdentity(
  identityToken: string
): Promise<MoltbookAgent> {
  const response = await fetch(
    "https://moltbook.com/api/v1/agents/verify-identity",
    {
      method: "POST",
      headers: {
        "X-Moltbook-App-Key": env.MOLTBOOK_APP_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: identityToken,
        audience: "moltapp.com",
      }),
    }
  );

  if (response.status === 401) {
    throw new Error("invalid_identity_token");
  }

  if (response.status === 429) {
    throw new Error("moltbook_rate_limited");
  }

  if (!response.ok) {
    throw new Error("moltbook_verification_failed");
  }

  const data = (await response.json()) as { agent: MoltbookAgent };
  return data.agent;
}
