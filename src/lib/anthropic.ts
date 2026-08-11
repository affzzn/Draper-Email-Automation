import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let client: Anthropic | null = null;

export function anthropic(): Anthropic | null {
  const key = env.anthropicApiKey;
  if (!key) return null; // graceful: pipeline degrades to deterministic-only
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

export const anthropicModel = () => env.anthropicModel;

// Small helper: one-shot completion returning plain text.
export async function complete(params: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string | null> {
  const a = anthropic();
  if (!a) return null;
  // Note: newer models (e.g. claude-sonnet-5) reject an explicit `temperature`.
  // Only include it when caller opts in AND we're on a model that accepts it.
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: anthropicModel(),
    max_tokens: params.maxTokens ?? 600,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  };
  if (params.temperature !== undefined && !/sonnet-5|opus-5|haiku-5/.test(anthropicModel())) {
    body.temperature = params.temperature;
  }
  const res = await a.messages.create(body);
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}
