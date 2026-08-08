import { NextRequest, NextResponse } from "next/server";
import { getDb, getActiveProfile, getProfile, getProfileQuestions } from "@/lib/db";
import { chatCompletion } from "@/lib/ai";
import { randomUUID } from "crypto";
import { getMediaFiles, needsRefresh, scanMediaFolder } from "@/lib/media-cache";
import { existsSync } from "fs";

type ProfileConfig = { endpoint: string; apiKey: string; model: string };

function appendMessage(sessionId: string, role: string, content: string) {
  getDb()
    .prepare("INSERT INTO conversation_messages (session_id, role, content) VALUES (?, ?, ?)")
    .run(sessionId, role, content);
}

function getMessages(sessionId: string): { role: "system" | "user" | "assistant"; content: string }[] {
  return getDb()
    .prepare("SELECT role, content FROM conversation_messages WHERE session_id = ? ORDER BY id")
    .all(sessionId) as { role: "system" | "user" | "assistant"; content: string }[];
}

function getFullMessages(sessionId: string) {
  return getDb().prepare("SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY id").all(sessionId);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
  const profileIdStr = url.searchParams.get("profile_id");
  const sessionIdFilter = url.searchParams.get("session_id");
  const profile = profileIdStr ? getProfile(Number(profileIdStr)) : getActiveProfile();

  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  if (sessionIdFilter) {
    return NextResponse.json({ messages: getFullMessages(sessionIdFilter) });
  }

  const askedQuestions = getProfileQuestions(profile.id).filter((q) => q.asked);

  if (askedQuestions.length === 0) {
    return NextResponse.json({ error: "No questions configured" }, { status: 400 });
  }

  const session_id = randomUUID();
  const config = { endpoint: profile.llm_endpoint, apiKey: profile.llm_api_key, model: profile.llm_model };

  let mediaContext = "";
  if (profile.media_enabled && profile.media_folder && existsSync(profile.media_folder)) {
    if (needsRefresh(profile.id)) {
      scanMediaFolder(profile.media_folder, profile.id, profile.timezone).catch(() => {});
    } else {
      const media = getMediaFiles({ profileId: profile.id, date });
      if (media.length > 0) {
        const names = media.slice(0, 8).map((m) => m.name).join(", ");
        mediaContext = `\n\nToday's media files: ${names}. The user may have taken photos or videos today. Reference these naturally only if relevant.`;
      }
    }
  }

  appendMessage(session_id, "system", profile.personality_prompt + mediaContext);

  try {
    if (profile.asking_method === "ask_in_one_go") {
      const qs = askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
      const greeting = await chatCompletion(config, [
        { role: "system", content: profile.personality_prompt + mediaContext },
        { role: "user", content: `Today's date is ${date}. Greet the user briefly, then ask ALL of these questions in one message, clearly numbered. Tell the user they can answer all at once:\n\n${qs}` },
      ]);
      appendMessage(session_id, "assistant", greeting);
    } else {
      const first = askedQuestions[0];
      const greeting = await chatCompletion(config, [
        { role: "system", content: profile.personality_prompt + mediaContext },
        { role: "user", content: `Today is ${date}. Greet the user briefly in your personality, then ask ONLY this one question naturally: "${first.question}"` },
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

  return NextResponse.json({
    session_id,
    messages: getFullMessages(session_id),
    profile_id: profile.id,
    asking_method: profile.asking_method,
    total_questions: askedQuestions.length,
    remaining_identifiers: askedQuestions.map((q) => q.identifier),
    media_context: mediaContext || null,
    enabled_integrations,
  });
}

export async function POST(req: NextRequest) {
  const { session_id, message } = await req.json();
  const db = getDb();

  const sessionRecord = db
    .prepare("SELECT 1 FROM conversation_messages WHERE session_id = ? LIMIT 1")
    .get(session_id);

  if (!sessionRecord) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  appendMessage(session_id, "user", message);

  const config: ProfileConfig = { endpoint: profile.llm_endpoint, apiKey: profile.llm_api_key, model: profile.llm_model };
  const askedQuestions = getProfileQuestions(profile.id).filter((q) => q.asked);

  try {
    const history = getMessages(session_id);

    if (askedQuestions.length > 0) {
      const checklist = askedQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
      const checkRes = await chatCompletion(config, [
        { role: "system", content: "You are a classifier. Read the conversation and decide if the user's latest message substantively addresses every question in the checklist. Respond with ONLY valid JSON in this exact shape: {\"covered\": true|false, \"missing\": [\"id1\", \"id2\"]}. Use the question's identifier (Q1, Q2, ...) for missing entries. If the user explicitly says 'done', 'that's it', 'no more', or asks to wrap up, treat all as covered." },
        ...history.slice(-6),
        { role: "user", content: `Checklist:\n${checklist}\n\nLatest user message: "${message}"` },
      ], 15_000);

      let parsed: any = null;
      try {
        parsed = JSON.parse(checkRes.match(/\{[\s\S]*\}/)?.[0] || "{}");
      } catch {
        // classifier returned garbage; fall back to default branch
      }

      if (parsed && parsed.covered === true) {
        const closing = await chatCompletion(config, [
          ...history,
          { role: "user", content: "All questions are answered. Wrap up warmly in your style. Tell the user their daily note is ready. Keep it short (1-2 lines)." },
        ]);
        appendMessage(session_id, "assistant", closing);
        return NextResponse.json({ status: "complete", messages: getFullMessages(session_id) });
      }

      if (profile.asking_method === "ask_in_one_go") {
        const ids = Array.isArray(parsed?.missing) && parsed.missing.length > 0
          ? parsed.missing.filter((id: string) => askedQuestions.some((q) => q.identifier === id))
          : askedQuestions.map((q) => q.identifier);
        const followUp = await chatCompletion(config, [
          ...history,
          { role: "user", content: ids.length === askedQuestions.length
            ? `The user's last message didn't clearly answer the questions. Stay in character and gently ask them to elaborate or answer the questions.`
            : `The user hasn't yet covered these: ${ids.join(", ")}. Gently ask the user to share those too. Stay in character. Keep it casual.` },
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
          { role: "user", content: "All questions have been answered. Wrap up warmly in your style. Tell the user their note is ready. 1-2 lines." },
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
