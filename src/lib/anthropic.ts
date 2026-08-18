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
  // Note: the current model generation (Fable 5, Opus 5, Opus 4.7/4.8, Sonnet 5)
  // REJECTS an explicit `temperature` with a 400. Only include it when the caller
  // opts in AND we're on an older model that still accepts it — otherwise the call
  // 400s and the caller silently falls back (e.g. the classifier drops to its
  // keyword heuristic). Match the models that reject it and never send it to them.
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: anthropicModel(),
    max_tokens: params.maxTokens ?? 600,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  };
  const rejectsTemperature = /fable-5|opus-5|sonnet-5|haiku-5|opus-4-[78]/.test(anthropicModel());
  if (params.temperature !== undefined && !rejectsTemperature) {
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
