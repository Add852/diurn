import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireProfile } from "@/lib/auth";
import { getDb, getActiveProfile, getProfileQuestions } from "@/lib/db";
import { chatCompletion, llmConfig, extractJson } from "@/lib/ai";
import { buildChatContext } from "@/lib/chat-context";
import { localDate } from "@/lib/timezone";
import { randomUUID } from "crypto";
import { scanMediaFolder, pendingScan, needsRefresh, isDirty, maybeBackgroundScan } from "@/lib/media-cache";
import { existsSync } from "fs";
import { appendMessage, getFullMessages, getMessages } from "@/lib/conversation";

const WRAPUP_PROMPT =
  "All questions are answered. Wrap up warmly in your style. Tell the user their daily note is ready. Keep it short (1-2 lines).";


export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = getActiveProfile();

  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const date = new URL(req.url).searchParams.get("date") || localDate(new Date(), profile.timezone, profile.day_offset_hours);

  const askedQuestions = getProfileQuestions(profile.id).filter((q) => q.asked);

  if (askedQuestions.length === 0) {
    return NextResponse.json({ error: "No questions configured" }, { status: 400 });
  }

  const session_id = randomUUID();
  const config = llmConfig(profile);
  if (profile.media_enabled && profile.media_folder && existsSync(profile.media_folder)) {
    // Fresh media guaranteed before answering. Static-prerendered pages mean
    // the layout's boot scan never ran on pure /api flows, so self-trigger
    // it (idempotent, once per process) and wait out any scan that is
    // running or needed. Normal case — scan done, nothing changed — no-op.
    maybeBackgroundScan();
    const pending = pendingScan(profile.id);
    if (pending) {
      await pending;
    } else if (needsRefresh(profile.id) || isDirty(profile.id)) {
      await scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours);
    }
  }

  const ctx = await buildChatContext(profile, date, config);

  const systemPrompt = profile.personality_prompt + ctx.text;

  appendMessage(session_id, "system", systemPrompt);

  try {
    // One instruction for the greeting, one call — same shape as POST.
    const instruction = profile.asking_method === "ask_in_one_go"
      ? `Today's date is ${date}. You have today's context in your system message. Acknowledge it lightly when relevant, then ask ALL of these questions in one message, clearly numbered. Tell the user they can answer all at once:\n\n${askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`
      : `Today is ${date}. You have today's context in your system message. Acknowledge it lightly when relevant, then ask ONLY this one question naturally: "${askedQuestions[0].question}"`;
    const greeting = await chatCompletion(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: instruction },
    ]);
    appendMessage(session_id, "assistant", greeting);
  } catch {
    // LLM unreachable: fall back to the plain question list so the session works.
    appendMessage(session_id, "assistant", askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n"));
  }

  const enabled_integrations: string[] = [];
  if (profile.media_enabled && profile.media_folder) enabled_integrations.push("media");
  if (profile.google_tasks_enabled) enabled_integrations.push("tasks");
  if (profile.google_calendar_enabled) enabled_integrations.push("calendar");
  if (profile.obsidian_enabled && profile.obsidian_folder) enabled_integrations.push("notes");

  return NextResponse.json({
    session_id,
    date,
    messages: getFullMessages(session_id),
    profile_id: profile.id,
    asking_method: profile.asking_method,
    total_questions: askedQuestions.length,
    remaining_identifiers: askedQuestions.map((q) => q.identifier),
    context: ctx.raw,
    enabled_integrations,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;
  const { session_id, message } = await req.json();
  const db = getDb();

  const sessionRecord = db
    .prepare("SELECT 1 FROM conversation_messages WHERE session_id = ? LIMIT 1")
    .get(session_id);

  if (!sessionRecord) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  appendMessage(session_id, "user", message);

  const config = llmConfig(profile);
  const askedQuestions = getProfileQuestions(profile.id).filter((q) => q.asked);

  // Every branch below ends the same way: pick an instruction for the next
  // assistant turn, run one completion over the transcript, append, return.
  // Only the instruction (and whether we're done) differs between branches.
  try {
    const history = getMessages(session_id);
    let instruction: string;
    let done = false;

    if (profile.asking_method === "one_by_one") {
      // Sequential mode: progress is just how many user turns we've seen.
      const userMsgCount = history.filter((m) => m.role === "user").length;
      if (userMsgCount >= askedQuestions.length) {
        instruction = WRAPUP_PROMPT;
        done = true;
      } else {
        const next = askedQuestions[Math.min(userMsgCount, askedQuestions.length - 1)];
        instruction = `Acknowledge the user's answer briefly, then ask ONLY the next question naturally: "${next.question}". Stay in your personality.`;
      }
    } else {
      // ask_in_one_go: a classifier checks the FULL transcript (an answer many
      // turns ago still counts) and reports which question identifiers remain.
      const transcript = history
        .filter((m) => m.role !== "system")
        .slice(-24)
        .map((m) => `${m.role === "user" ? "user" : "assistant"}: ${m.content.length > 400 ? m.content.slice(0, 400) + "…" : m.content}`)
        .join("\n");
      const checklist = askedQuestions.map((q) => `${q.identifier}: ${q.question}`).join("\n");
      const checkRes = await chatCompletion(config, [
        { role: "system", content: `You check whether a journal conversation has covered every question. Answer with ONLY JSON: {"covered": boolean, "missing": [identifiers not yet answered]}. covered=true only when every question is answered or the user clearly wants to wrap up ("done", "that's it", "no more"). Use the exact identifiers from the checklist.` },
        { role: "user", content: `Checklist:\n${checklist}\n\nTranscript:\n${transcript}\n\nLatest user message: "${message}"` },
      ], 20_000);

      const rec = extractJson(checkRes);
      const covered = rec?.covered === true;
      const missingIds = Array.isArray(rec?.missing)
        ? rec!.missing.filter((id): id is string => typeof id === "string" && askedQuestions.some((q) => q.identifier === id))
        : [];

      if (covered) {
        instruction = WRAPUP_PROMPT;
        done = true;
      } else if (missingIds.length === 0) {
        // Classifier didn't flag done but nothing is missing: confirm before writing.
        instruction = "The user has answered the questions but hasn't confirmed they're done yet. In character, ask in one line if there's anything else they'd like to add before the note is written.";
      } else if (missingIds.length === askedQuestions.length) {
        instruction = "The user's last message didn't clearly answer the questions. Stay in character and gently ask them to elaborate or answer the questions.";
      } else {
        instruction = `The user hasn't yet covered these: ${missingIds.join(", ")}. Gently ask the user to share those too. Stay in character. Keep it casual.`;
      }
    }

    const reply = await chatCompletion(config, [...history, { role: "user", content: instruction }]);
    appendMessage(session_id, "assistant", reply);
    return NextResponse.json({ status: done ? "complete" : "awaiting_input", messages: getFullMessages(session_id) });
  } catch (err: any) {
    appendMessage(session_id, "assistant", `AI connection error: ${err.message}. Check your endpoint in Settings > AI.`);
  }

  return NextResponse.json({ status: "awaiting_input", messages: getFullMessages(session_id) });
}
