import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireProfile } from "@/lib/auth";
import { getDb, getActiveProfile, getProfile, getProfileQuestions } from "@/lib/db";
import { chatCompletion, llmConfig } from "@/lib/ai";
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

  const url = new URL(req.url);
  const profileIdStr = url.searchParams.get("profile_id");
  const sessionIdFilter = url.searchParams.get("session_id");
  const profile = profileIdStr ? getProfile(Number(profileIdStr)) : getActiveProfile();

  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const date = url.searchParams.get("date") || localDate(new Date(), profile.timezone, profile.day_offset_hours);

  if (sessionIdFilter) {
    return NextResponse.json({ messages: getFullMessages(sessionIdFilter) });
  }

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
    if (profile.asking_method === "ask_in_one_go") {
      const qs = askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
      const greeting = await chatCompletion(config, [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Today's date is ${date}. You have today's context in your system message. Acknowledge it lightly when relevant, then ask ALL of these questions in one message, clearly numbered. Tell the user they can answer all at once:\n\n${qs}` },
      ]);
      appendMessage(session_id, "assistant", greeting);
    } else {
      const first = askedQuestions[0];
      const greeting = await chatCompletion(config, [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Today is ${date}. You have today's context in your system message. Acknowledge it lightly when relevant, then ask ONLY this one question naturally: "${first.question}"` },
      ]);
      appendMessage(session_id, "assistant", greeting);
    }
  } catch {
    const qs = askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
    appendMessage(session_id, "assistant", qs);
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

  try {
    const history = getMessages(session_id);
    if (askedQuestions.length > 0) {
      // Full transcript, not just recent turns: an answer given many messages
      // ago must still count. Each message is truncated to keep long chats cheap.
      const transcript = history
        .filter((m) => m.role !== "system")
        .slice(-24)
        .map((m) => `${m.role === "user" ? "user" : "assistant"}: ${m.content.length > 400 ? m.content.slice(0, 400) + "…" : m.content}`)
        .join("\n");
      const checklist = askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
      const checkRes = await chatCompletion(config, [
        { role: "system", content: "You are a classifier. Evaluate the FULL transcript against the question checklist. A question counts as answered if its answer appears anywhere in the transcript, including earlier turns. Respond with ONLY valid JSON in this exact shape: {\"covered\": true|false, \"missing\": [\"id1\", \"id2\"]}. Use the question's identifier (Q1, Q2, ...) for missing entries. If every question is answered, missing MUST be an empty array and covered MUST be true. If the user explicitly says 'done', 'that's it', 'no more', or asks to wrap up, treat all as covered." },
        { role: "user", content: `Checklist (identifier: question):\n${checklist}\n\nTranscript:\n${transcript}\n\nLatest user message: "${message}"` },
      ], 20_000);

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(checkRes.match(/\{[\s\S]*\}/)?.[0] || "{}");
      } catch {
        // classifier returned garbage; fall back to the awaiting-input branch below
      }
      const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      const covered = rec?.covered === true;
      const missingIds = Array.isArray(rec?.missing)
        ? rec.missing.filter((id): id is string => typeof id === "string" && askedQuestions.some((q) => q.identifier === id))
        : [];

      // Stop condition: the full transcript answers every question.
      if (covered) {
        const closing = await chatCompletion(config, [
          ...history,
          { role: "user", content: WRAPUP_PROMPT },
        ]);
        appendMessage(session_id, "assistant", closing);
        return NextResponse.json({ status: "complete", messages: getFullMessages(session_id) });
      }

      if (missingIds.length === 0) {
        // Nothing left missing but not flagged done: nudge, never re-ask answered questions.
        const nudge = await chatCompletion(config, [
          ...history,
          { role: "user", content: "The user has answered the questions but hasn't confirmed they're done yet. In character, ask in one line if there's anything else they'd like to add before the note is written." },
        ]);
        appendMessage(session_id, "assistant", nudge);
        return NextResponse.json({ status: "awaiting_input", messages: getFullMessages(session_id) });
      }
      if (profile.asking_method === "ask_in_one_go") {
        const followUp = await chatCompletion(config, [
          ...history,
          { role: "user", content: missingIds.length === askedQuestions.length
            ? `The user's last message didn't clearly answer the questions. Stay in character and gently ask them to elaborate or answer the questions.`
            : `The user hasn't yet covered these: ${missingIds.join(", ")}. Gently ask the user to share those too. Stay in character. Keep it casual.` },
        ]);
        appendMessage(session_id, "assistant", followUp);
        return NextResponse.json({ status: "awaiting_input", messages: getFullMessages(session_id) });
      }
    }

    if (profile.asking_method === "one_by_one") {
      const userMsgCount = history.filter((m) => m.role === "user").length;
      if (userMsgCount >= askedQuestions.length) {
        const closing = await chatCompletion(config, [
          ...history,
          { role: "user", content: WRAPUP_PROMPT },
        ]);
        appendMessage(session_id, "assistant", closing);
        return NextResponse.json({ status: "complete", messages: getFullMessages(session_id) });
      }

      const next = askedQuestions[Math.min(userMsgCount, askedQuestions.length - 1)];
      const reply = await chatCompletion(config, [
        ...history,
        { role: "user", content: `Acknowledge the user's answer briefly, then ask ONLY the next question naturally: "${next.question}". Stay in your personality.` },
      ]);
      appendMessage(session_id, "assistant", reply);
    }
  } catch (err: any) {
    appendMessage(session_id, "assistant", `AI connection error: ${err.message}. Check your endpoint in Settings > AI.`);
  }

  return NextResponse.json({ status: "awaiting_input", messages: getFullMessages(session_id) });
}
