import { NextRequest, NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/db";
import { chatCompletion } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const config = { endpoint: profile.llm_endpoint, apiKey: profile.llm_api_key, model: profile.llm_model };

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
    return NextResponse.json({ success: false, error: err.message, endpoint: config.endpoint }, { status });
  }
}