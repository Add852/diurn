interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export function llmConfig(profile: { llm_endpoint: string; llm_api_key: string; llm_model: string }) {
  return { endpoint: profile.llm_endpoint, apiKey: profile.llm_api_key, model: profile.llm_model };
}

// AI is usable only when the master toggle is on AND an endpoint+model exist.
// Everything that consumes AI should go through this so "disabled" behaves
// identically to "not configured" (chat hidden, forms fall back to raw…).
export function aiAvailable(profile: { ai_enabled?: number; llm_endpoint: string; llm_model: string }): boolean {
  return !!profile.ai_enabled && !!profile.llm_endpoint && !!profile.llm_model;
}

// Pull the first {...} JSON object out of an LLM reply (models love prose
// around JSON). Greedy to the last } so nested objects survive. Returns null
// when there's nothing parseable.
export function extractJson(reply: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] || "null");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ChatConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export async function chatCompletion(
  config: ChatConfig,
  messages: Message[],
  timeoutMs = 30_000
): Promise<string> {
  if (!config.endpoint || !config.model) {
    throw new Error("AI is not configured — set an endpoint and model in Settings → AI");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${config.endpoint.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.model, messages, temperature: 0.7, max_tokens: 1024, stream: false }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("LLM request timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  }

  try {
    const raw = await res.text();
    const clean = raw.replace(/\ndata:\s*\[DONE\]\s*$/, "").replace(/\s*data:\s*\[DONE\].*$/, "").trim();
    const content: string = JSON.parse(clean).choices?.[0]?.message?.content ?? "";
    return stripThinking(content);
  } catch {
    throw new Error("LLM returned invalid JSON response");
  }
}

// Reasoning models (DeepSeek R1, QwQ, Qwen3…) leak their chain-of-thought
// into content — either wrapped in <think>…</think> or as text before a bare
// closing </think>. Strip both; if the reply was ONLY thinking, fall back to
// the raw content rather than an empty string. reasoning_content fields are
// simply never read.
function stripThinking(content: string): string {
  const noBlocks = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (noBlocks) return noBlocks;
  const idx = content.lastIndexOf("</think>");
  if (idx >= 0) return content.slice(idx + "</think>".length).trim();
  return content.trim();
}
