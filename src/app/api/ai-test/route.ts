import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { chatCompletion, llmConfig } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;

  // Allow overriding the saved config so the UI can test what the user just typed,
  // without forcing a save first. Falls back to the stored profile fields.
  const body = await req.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : profile.llm_endpoint;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : profile.llm_model;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey : profile.llm_api_key;

  if (!endpoint || !model) {
    return NextResponse.json({ success: false, error: "Endpoint and model are required" }, { status: 400 });
  }

  const config = { endpoint, model, apiKey };

  try {
    const start = Date.now();
    const reply = await chatCompletion(config, [
      { role: "user", content: "Say 'Connection test successful!' in exactly 5 words or fewer." },
    ]);
    const ms = Date.now() - start;
    return NextResponse.json({ success: true, reply, latency_ms: ms, endpoint: config.endpoint, model: config.model });
  } catch (err: any) {
    const statusMatch = err.message?.match(/LLM error (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 502;
    return NextResponse.json({ success: false, error: err.message, endpoint: config.endpoint, model: config.model }, { status });
  }
}