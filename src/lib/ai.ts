interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProfileConfig {
  llm_endpoint: string;
  llm_api_key: string;
  llm_model: string;
  ai_enabled?: number;
  llm_retries?: number;
  llm_retry_delay_ms?: number;
  llm_timeout_ms?: number;
  llm_thinking?: number;
}

export function llmConfig(profile: LlmProfileConfig) {
  // ai_enabled === 0 (strictly the off state — undefined means the caller
  // didn't set it, e.g. ai-test's ad-hoc config) kills the endpoint so every
  // consumer sees "AI is not configured". Disabled AI must behave identically
  // to unconfigured AI everywhere — including obsidian summarizeNotes.
  const off = profile.ai_enabled === 0;
  return {
    endpoint: off ? "" : profile.llm_endpoint,
    apiKey: profile.llm_api_key,
    model: profile.llm_model,
    retries: profile.llm_retries ?? 2,
    retryDelayMs: profile.llm_retry_delay_ms ?? 1000,
    timeoutMs: profile.llm_timeout_ms ?? 120_000,
    thinking: !!profile.llm_thinking,
  };
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
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  thinking?: boolean;
}

// Human-meaningful cause for an HTTP status from an OpenAI-compatible server.
function httpReason(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return "authentication failed — check your API key";
    case 404:
      return "endpoint not found — the URL should end in /v1 (e.g. http://localhost:11434/v1)";
    case 413:
      return "request too large — the input exceeds the server's limit (try a shorter context)";
    case 429:
      return "rate limit exceeded — too many requests too fast";
    case 500:
      return "server error — the LLM server crashed processing this request (check its own logs)";
    case 502:
    case 503:
    case 504:
      return "server overloaded or restarting — it may not be ready yet";
    default:
      return "";
  }
}

// Pull the useful message out of an error response body. OpenAI-compatible
// servers use {"error": {"message": "..."}}; Ollama uses {"error": "..."};
// some return plain text.
function extractBodyMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message || j?.error || j?.message;
    if (typeof m === "string" && m.trim()) return m.trim().slice(0, 300);
  } catch {}
  return body.trim().slice(0, 300);
}

// Endpoints that rejected the thinking request params — in-process memo so
// the negotiation costs at most one extra request per endpoint+model.
const rejectedThinkParams = new Set<string>();

export async function chatCompletion(
  config: ChatConfig,
  messages: Message[],
  timeoutMs?: number
): Promise<string> {
  if (!config.endpoint || !config.model) {
    throw new Error("AI is not configured — set an endpoint and model in Settings → AI");
  }

  const perTryTimeout = timeoutMs ?? config.timeoutMs ?? 120_000;
  const maxAttempts = 1 + Math.max(0, Math.min(config.retries ?? 2, 5));
  const baseDelay = Math.max(0, config.retryDelayMs ?? 1000);
  const url = `${config.endpoint.replace(/\/$/, "")}/chat/completions`;
  // Thinking/reasoning request params. The model landscape is heterogeneous:
  // some models think by default, some can't think at all, and some strict
  // servers reject unknown params with a 400. So: send the two widely
  // understood switches (Ollama `think`, Qwen-style `enable_thinking`) in the
  // requested direction; if the server 400/422s while they were sent, retry
  // once WITHOUT them and memoize per endpoint+model so later calls skip the
  // negotiation. stripThinking below is the unconditional safety net — models
  // that think regardless never leak reasoning into output.
  // ponytail: skip provider-specific switches (reasoning_effort, chat_template_kwargs) — add only if a user's server needs one.
  const thinkKey = `${url}|${config.model}`;
  let thinkParams: Record<string, unknown> | null = rejectedThinkParams.has(thinkKey)
    ? null
    : config.thinking
      ? { think: true, enable_thinking: true }
      : { think: false, enable_thinking: false };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Always send a Bearer header: keyless local servers ignore it, but some
  // gateways/proxies reject requests lacking the header outright ("API key
  // is required") even when the backend itself needs no key.
  headers["Authorization"] = `Bearer ${config.apiKey || "none"}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perTryTimeout);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        // 4096: reasoning models burn most of the budget on thinking before
        // the answer — 1024 truncated real answers.
        body: JSON.stringify({ model: config.model, messages, temperature: 0.7, max_tokens: 4096, stream: false, ...(thinkParams ?? {}) }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const detail = extractBodyMessage(bodyText);
        const reason = httpReason(res.status);
        const msg = `LLM error ${res.status}${reason ? ` (${reason})` : ""}${detail ? `: ${detail}` : ""}`;
        const err = new Error(msg) as Error & { status?: number; retryAfterMs?: number };
        err.status = res.status;
        // 429: honor Retry-After when present (seconds or HTTP date).
        if (res.status === 429) {
          const ra = res.headers.get("retry-after");
          if (ra) {
            const secs = Number(ra);
            err.retryAfterMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : Math.max(0, (Date.parse(ra) - Date.now()) || 0);
          }
        }
        throw err;
      }

      const raw = await res.text();
      const clean = raw.replace(/\ndata:\s*\[DONE\]\s*$/, "").replace(/\s*data:\s*\[DONE\].*$/, "").trim();
      const content: string = JSON.parse(clean).choices?.[0]?.message?.content ?? "";
      return stripThinking(content);
    } catch (err: any) {
      lastError = err;

      // Server rejected the thinking params (400/422 = client error; strict
      // OpenAI-style servers 400 unknown fields). Retry the same attempt
      // without them, once per server lifetime (memoized).
      if ((err.status === 400 || err.status === 422) && thinkParams) {
        rejectedThinkParams.add(thinkKey);
        thinkParams = null;
        attempt--; // param negotiation doesn't consume a retry
        continue;  // and skips the backoff below
      }

      const retriable =
        err.name === "AbortError" || // timeout — slow/thinking model, try again
        err.status === 429 ||
        (err.status !== undefined && err.status >= 500) ||
        err.status === undefined; // network-level failure (fetch threw)

      if (!retriable || attempt === maxAttempts) {
        if (err.name === "AbortError") {
          throw new Error(
            `LLM request timed out after ${Math.round(perTryTimeout / 1000)}s` +
              (attempt > 1 ? ` (${attempt} attempts) — the model may be too slow or still thinking; raise the timeout in Settings → AI` : " — the model may be too slow or still thinking; raise the timeout in Settings → AI")
          );
        }
        // Network-level fetch errors (connection refused, DNS, TLS): describe
        // them instead of passing through opaque codes.
        if (err.status === undefined && !(err instanceof Error && err.message.startsWith("LLM error"))) {
          const code = err?.cause?.code || err?.code || "";
          const hint =
            code === "ECONNREFUSED" ? " — is the LLM server running at that address?"
            : code === "ENOTFOUND" || code === "EAI_AGAIN" ? " — the hostname could not be resolved"
            : code === "ECONNRESET" || code === "ETIMEDOUT" ? " — the connection dropped mid-request"
            : "";
          throw new Error(`Could not reach ${url}${hint}${code ? ` (${code})` : ""}`);
        }
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }

    // Backoff before the next attempt: base delay doubling per attempt,
    // overridden by Retry-After on 429.
    const delay = err_retryAfter(lastError) ?? baseDelay * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, Math.min(delay, 30_000)));
  }

  throw lastError ?? new Error("LLM request failed");
}

function err_retryAfter(err: any): number | null {
  return err && typeof err.retryAfterMs === "number" && err.retryAfterMs > 0 ? err.retryAfterMs : null;
}

// Reasoning models (DeepSeek R1, QwQ, Qwen or as text before a bare
// closing </think>. Strip both; if the reply was ONLY thinking, fall back to
// the raw content rather than an empty string. reasoning_content fields are
// simply never read.
function stripThinking(content: string): string {
  // Reasoning models emit thinking either as <think>...</think> blocks or as
  // text before a bare closing </think> (Ollama R1 style: everything before
  // the tag is reasoning, everything after is the answer). Bare-closing-tag
  // check FIRST — a paired block still leaves non-empty text outside, but a
  // trailing bare tag makes the earlier text thinking, not answer.
  const idx = content.lastIndexOf("</think>");
  if (idx >= 0) {
    const after = content.slice(idx + "</think>".length).trim();
    if (after) return after;
    // Nothing after the tag: if an opening tag exists too, the whole thing
    // was thinking — fall through to the block strip; otherwise treat the
    // content as prose that happens to end with the tag.
    if (content.includes("<think>")) return "";
  }
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
