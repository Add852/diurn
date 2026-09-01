interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export function llmConfig(profile: { llm_endpoint: string; llm_api_key: string; llm_model: string }) {
  return { endpoint: profile.llm_endpoint, apiKey: profile.llm_api_key, model: profile.llm_model };
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
    return JSON.parse(clean).choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error("LLM returned invalid JSON response");
  }
}
