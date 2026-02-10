/**
 * Shared client initialization utilities for AI trading agents.
 *
 * Extracts the common pattern of lazy client initialization with environment
 * variable validation that's duplicated across all agent implementations.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/**
 * Creates a lazy-initialized Anthropic client getter function.
 * Returns a function that initializes the client on first call.
 */
export function createAnthropicClientGetter(): () => Anthropic {
  let client: Anthropic | null = null;

  return () => {
    if (!client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY environment variable is not set. Claude agent cannot trade.",
        );
      }
      client = new Anthropic({ apiKey });
    }
    return client;
  };
}

/**
 * Creates a lazy-initialized OpenAI client getter function.
 * Returns a function that initializes the client on first call.
 */
export function createOpenAIClientGetter(): () => OpenAI {
  let client: OpenAI | null = null;

  return () => {
    if (!client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY environment variable is not set. GPT agent cannot trade.",
        );
      }
      client = new OpenAI({ apiKey });
    }
    return client;
  };
}

/**
 * Creates a lazy-initialized xAI (Grok) client getter function.
 * xAI uses the OpenAI SDK with a custom base URL.
 * Returns a function that initializes the client on first call.
 */
export function createXAIClientGetter(): () => OpenAI {
  let client: OpenAI | null = null;

  return () => {
    if (!client) {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "XAI_API_KEY environment variable is not set. Grok agent cannot trade.",
        );
      }
      client = new OpenAI({
        apiKey,
        baseURL: "https://api.x.ai/v1",
      });
    }
    return client;
  };
}

/**
 * Creates a lazy-initialized Google Gemini client getter function.
 * Gemini uses the OpenAI SDK with Google's OpenAI-compatible endpoint.
 * Returns a function that initializes the client on first call.
 */
export function createGeminiClientGetter(): () => OpenAI {
  let client: OpenAI | null = null;

  return () => {
    if (!client) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GOOGLE_API_KEY environment variable is not set. Gemini agent cannot trade.",
        );
      }
      client = new OpenAI({
        apiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
    }
    return client;
  };
}
