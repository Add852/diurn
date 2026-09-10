import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveProfile, getProfileQuestions } from "@/lib/db";
import { llmConfig } from "@/lib/ai";
import { buildChatContext, distillContext } from "@/lib/chat-context";
import { localDate } from "@/lib/timezone";
import { scanMediaFolder, pendingScan, needsRefresh, isDirty, maybeBackgroundScan } from "@/lib/media-cache";
import { existsSync } from "fs";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = getActiveProfile();
  if (!profile) return NextResponse.json({ error: "No active profile" }, { status: 400 });

  const date = new URL(req.url).searchParams.get("date") || localDate(new Date(), profile.timezone, profile.day_offset_hours);

  const allQuestions = getProfileQuestions(profile.id);
  if (allQuestions.length === 0) {
    return NextResponse.json({ error: "No questions configured" }, { status: 400 });
  }

  const aiOn = !!profile.ai_enabled && !!profile.llm_endpoint && !!profile.llm_model;

  // asked=false questions are only asked when a human must answer them (AI
  // off, or raw output — no AI inference pass will run). With AI output on,
  // they're hidden and the AI infers their answers from the user's input.
  const manualAnswers = !aiOn || profile.form_output === "raw";
  const questions = manualAnswers
    ? allQuestions
    : allQuestions.filter((q) => q.asked);

  if (profile.media_enabled && profile.media_folder && existsSync(profile.media_folder)) {
    maybeBackgroundScan();
    if (!pendingScan(profile.id) && (needsRefresh(profile.id) || isDirty(profile.id))) {
      scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours).catch(() => {});
    }
  }

  const ctx = await buildChatContext(profile, date, llmConfig(profile));

  const enabled_integrations: string[] = [];
  if (profile.media_enabled && profile.media_folder) enabled_integrations.push("media");
  if (profile.google_tasks_enabled) enabled_integrations.push("tasks");
  if (profile.google_calendar_enabled) enabled_integrations.push("calendar");
  if (profile.obsidian_enabled && profile.obsidian_folder) enabled_integrations.push("notes");

  return NextResponse.json({
    date,
    questions: questions.map((q) => ({ identifier: q.identifier, question: q.question, answer_prompt: q.answer_prompt || "" })),
    ui_mode: profile.ui_mode,
    ask_mode: profile.ask_mode,
    personality: profile.personality_prompt,
    form_output: profile.form_output,
    ai_available: aiOn,
    context: ctx.raw,
    context_sources: distillContext(ctx.raw, !!profile.media_in_context).sources,
    context_media_included: !!profile.media_in_context,
    enabled_integrations,
  });
}
