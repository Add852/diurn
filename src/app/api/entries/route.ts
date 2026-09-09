import { NextRequest, NextResponse } from "next/server";
import { getDb, getActiveProfile, getProfileQuestions, getStreakStatus, type ProfileQuestion } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { chatCompletion, llmConfig } from "@/lib/ai";
import { renderTemplate, type TemplateVar } from "@/lib/template";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { join, extname } from "path";
import { getMessages } from "@/lib/conversation";

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + "T00:00:00");
  return (
    !isNaN(d.getTime()) &&
    d.getFullYear() === Number(date.slice(0, 4)) &&
    d.getMonth() === Number(date.slice(5, 7)) - 1 &&
    d.getDate() === Number(date.slice(8, 10))
  );
}

// Atomic write: tmp + rename — readers never see a half-written note.
function writeNote(dir: string, date: string, content: string): string {
  const filePath = join(dir, `${date}.md`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
  return filePath;
}
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");
  const streakOnly = url.searchParams.get("streak") === "1";
  const queryDate = url.searchParams.get("date");
  const profile = getActiveProfile();
  const db = getDb();

  if (streakOnly && profile) {
    return NextResponse.json(getStreakStatus(profile.id, profile.timezone, profile.day_offset_hours));
  }

  let query = "SELECT * FROM entries";
  const params: any[] = [];

  if (profile) {
    query += " WHERE profile_id = ?";
    params.push(profile.id);
  }

  if (month && year) {
    query += profile ? " AND" : " WHERE";
    query += " strftime('%Y-%m', date) = ?";
    params.push(`${year}-${String(month).padStart(2, "0")}`);
  }

  if (queryDate) {
    query += profile ? " AND" : " WHERE";
    query += " date = ?";
    params.push(queryDate);
  }

  query += " ORDER BY date DESC";
  const dbEntries = db.prepare(query).all(...params) as any[];

  const seenDates = new Set(dbEntries.map((e) => e.date));
  let fsOnlyId = 0;

    if (profile?.daily_note_folder) {
      const dirFiles = await readdir(profile.daily_note_folder).catch(() => [] as string[]);
    for (const file of dirFiles.filter((f) => extname(f) === ".md")) {
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!dateMatch) continue;
      const date = dateMatch[1];
      if (seenDates.has(date)) continue;
      if (month && year && !date.startsWith(`${year}-${String(month).padStart(2, "0")}`)) continue;
      if (queryDate && date !== queryDate) continue;

      const content = await readFile(join(profile.daily_note_folder, file), "utf-8").catch(() => "");
      if (!content) continue;
      seenDates.add(date);
      dbEntries.push({
        id: -(++fsOnlyId),
        date,
        rendered_markdown: content,
        file_path: join(profile.daily_note_folder, file),
        profile_id: profile.id,
        _fs_only: true,
      });
    }
    }

dbEntries.sort((a, b) => b.date.localeCompare(a.date));
  return NextResponse.json(dbEntries);
}

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { session_id, date, overwrite, answers: formAnswers, blob, context } = await req.json();
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  if (!isValidDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const db = getDb();

  const existing = db.prepare("SELECT id FROM entries WHERE profile_id = ? AND date = ?").get(profile.id, date);
  if (existing && !overwrite) {
    return NextResponse.json({ exists: true, error: "Entry already exists for this date" }, { status: 409 });
  }
  if (overwrite && existing) {
    db.prepare("DELETE FROM entries WHERE id = ?").run((existing as any).id);
  }

  const aiOn = !!profile.ai_enabled && !!profile.llm_endpoint && !!profile.llm_model;

  // Raw context snapshot: the form/chat page passes back the context object
  // it fetched (/api/form or /api/chat already built it). Saved atomically as
  // {date}-context.json next to the notes when the user opted in.
  let contextSaved = false;
  if (profile.raw_context_enabled && profile.raw_context_folder && context) {
    try {
      const ctxDir = profile.raw_context_folder;
      if (!existsSync(ctxDir)) mkdirSync(ctxDir, { recursive: true });
      const ctxPath = join(ctxDir, `${date}-context.json`);
      const tmp = ctxPath + ".tmp";
      writeFileSync(tmp, JSON.stringify({ date, saved_at: new Date().toISOString(), context }, null, 2), "utf-8");
      renameSync(tmp, ctxPath);
      contextSaved = true;
    } catch {}
  }

  // Form submissions arrive as {answers: {identifier: text}} or {blob: text}
  // (one-big-text mode) instead of a chat session. Both skip the transcript
  // plumbing below and land directly in the answer slots.
  const isFormSubmission = formAnswers !== undefined || blob !== undefined;

  const messages = session_id ? getMessages(session_id) : [];
  if (!isFormSubmission && messages.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  const questions = getProfileQuestions(profile.id);
  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
  const config = llmConfig(profile);

  // Answer generation — one call per question where the reply text itself IS
  // the answer. No JSON, no parsing: formatting can't fail. AI failure can't
  // break the batch either (each call pre-fills, a failed call just keeps it).
  const answers: Record<string, TemplateVar> = {};
  let extractionWarning: string | undefined;

  // form_each: per-question inputs land verbatim — the user typed them. With
  // raw output they're final; with AI output the settle() pass below refines
  // them (guided by answer_prompt) and keeps the raw text on failure.
  if (isFormSubmission && formAnswers) {
    for (const q of questions) {
      const text = (formAnswers[q.identifier] ?? "").trim();
      if (text) answers[q.identifier] = { question: q.question, answer: text, asked: true, prompt: q.answer_prompt || "" };
    }
  }

  // form_single: one big blob answers everything; AI (or the template) splits
  // it per question. AI off at submit time -> 400 (UI shouldn't offer it, but
  // a stale tab could).
  if (isFormSubmission && blob !== undefined) {
    if (typeof blob !== "string" || !blob.trim()) {
      return NextResponse.json({ error: "Empty submission" }, { status: 400 });
    }
    if (!aiOn) {
      return NextResponse.json({ error: "AI is not available — the one-big-text input needs AI. Enable it in Settings → AI, or use separate inputs." }, { status: 400 });
    }
    // The blob is the sole user turn; settle() extracts per-question answers.
  }

  // chat_one_by_one: question i is answered by user message i (the flow's own
  // stop condition). Raw answer pre-fills the slot — good even without AI.
  if (!isFormSubmission && profile.input_method === "chat_one_by_one") {
    const asked = questions.filter((q) => q.asked);
    for (let i = 0; i < asked.length; i++) {
      const q = asked[i];
      answers[q.identifier] = { question: q.question, answer: userMessages[i]?.trim() || "", asked: true, prompt: q.answer_prompt || "" };
    }
  }

  const transcript = messages
    .map((m) => `${m.role === "user" ? "user" : "assistant"}: ${m.content}`)
    .join("\n");

  const settle = async (q: ProfileQuestion) => {
    const fallback = answers[q.identifier]?.answer || "";
    const guidance = q.answer_prompt
      ? `Answering instructions: ${q.answer_prompt}`
      : "Extract or infer the answer from the conversation, focusing on what the user actually said.";
    try {
      const reply = await chatCompletion(config, [
        { role: "system", content: `You answer ONE question about the user's day for their journal note. ${guidance} Answer in 1-3 sentences, plain prose, no preamble, no quotes, no markdown. If the conversation contains nothing relevant, reply with just "-".` },
        { role: "user", content: `Question: ${q.question}\n\nConversation:\n${blob !== undefined ? `user: ${blob}` : transcript}` },
      ], 45_000);
      const clean = reply.trim();
      if (clean && clean !== "-") {
        answers[q.identifier] = { question: q.question, answer: clean, asked: !!q.asked, prompt: q.answer_prompt || "" };
      }
    } catch {
      // AI unreachable / call failed: keep the raw pre-fill (one_by_one user
      // text) — better than empty. The note still renders either way.
    }
  };

  // AI pass — only when AI is on AND the method wants AI output. Form users
  // who chose raw output keep their typed text verbatim; form blob and chat
  // always want AI (chat IS AI; blob needs AI to split, guarded above).
  const wantsAi =
    aiOn &&
    (isFormSubmission
      ? blob !== undefined || profile.form_output === "ai"
      : true);

  if (questions.length > 0 && wantsAi) {
    // Pre-fill every remaining slot (asked-in-one-go raws + unasked + missing)
    // so failures render empty answers instead of literal {identifier.answer}.
    for (const q of questions) {
      if (!answers[q.identifier]) {
        answers[q.identifier] = { question: q.question, answer: "", asked: !!q.asked, prompt: q.answer_prompt || "" };
      }
    }
    await Promise.all(questions.map((q) => settle(q)));

    const missing = questions.filter((q) => !answers[q.identifier]?.answer);
    if (missing.length === questions.length) {
      extractionWarning = "AI answer generation failed — answers are empty. Check Settings → AI (endpoint/model).";
    } else if (missing.length > 0) {
      extractionWarning = `No answer generated for: ${missing.map((q) => q.identifier).join(", ")}`;
    }
  }


  let templateContent = "";
  if (profile.template_note_path && existsSync(profile.template_note_path)) {
    templateContent = readFileSync(profile.template_note_path, "utf-8");
  } else {
    templateContent = DEFAULT_TEMPLATE;
  }

  const rendered = renderTemplate(templateContent, answers, date);

  let filePath = "";
  if (profile.daily_note_folder) {
    filePath = writeNote(profile.daily_note_folder, date, rendered);
  }

  const result = db
    .prepare("INSERT INTO entries (profile_id, date, rendered_markdown, file_path) VALUES (?, ?, ?, ?)")
    .run(profile.id, date, rendered, filePath || null);

  const entryId = result.lastInsertRowid as number;
  const answerStmt = db.prepare("INSERT INTO entry_answers (entry_id, question_id, answer_text) VALUES (?, ?, ?)");
  for (const q of questions) {
    if (answers[q.identifier]) {
      answerStmt.run(entryId, q.id, answers[q.identifier].answer);
    }
  }

  return NextResponse.json({ entry_id: entryId, file_path: filePath, rendered, answers, extraction_warning: extractionWarning, context_saved: contextSaved });
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { date, markdown } = await req.json();
  if (typeof date !== "string" || !isValidDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (typeof markdown !== "string" || !markdown.trim()) {
    return NextResponse.json({ error: "Markdown is required" }, { status: 400 });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const db = getDb();
  type EntryRow = { id: number; file_path: string | null };
  const existing = db.prepare("SELECT id, file_path FROM entries WHERE profile_id = ? AND date = ?").get(profile.id, date) as EntryRow | undefined;

  // GET lists files in the notes folder that have no DB row (pre-existing .md,
  // DB reset with files kept, other profile sharing the folder). Adopt those
  // instead of 404ing while the file clearly exists.
  const notePath = profile.daily_note_folder ? join(profile.daily_note_folder, `${date}.md`) : null;
  const fsOnly = !existing && !!notePath && existsSync(notePath);
  if (!existing && !fsOnly) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Keep the Obsidian note in sync with the edit (same atomic write as POST).
  let filePath: string | null = null;
  if (notePath) {
    filePath = writeNote(profile.daily_note_folder!, date, markdown);
  }

  if (existing) {
    db.prepare("UPDATE entries SET rendered_markdown = ?, file_path = ? WHERE id = ?").run(
      markdown,
      filePath,
      existing.id
    );
    return NextResponse.json({ ok: true, id: existing.id, file_path: filePath });
  }

  const result = db
    .prepare("INSERT INTO entries (profile_id, date, rendered_markdown, file_path) VALUES (?, ?, ?, ?)")
    .run(profile.id, date, markdown, filePath);
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid), file_path: filePath });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || "";
  if (!isValidDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const db = getDb();
  type EntryRow = { id: number; file_path: string | null };
  const existing = db.prepare("SELECT id, file_path FROM entries WHERE profile_id = ? AND date = ?").get(profile.id, date) as EntryRow | undefined;

  const notePath = profile.daily_note_folder ? join(profile.daily_note_folder, `${date}.md`) : null;
  const fsOnly = !existing && !!notePath && existsSync(notePath);
  if (!existing && !fsOnly) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  if (existing) db.prepare("DELETE FROM entries WHERE id = ?").run(existing.id);

  // Only remove the note file when it lives under the configured notes folder —
  // never delete a path the app didn't create.
  const fp = existing?.file_path ?? notePath;
  if (fp && profile.daily_note_folder) {
    const base = profile.daily_note_folder.replace(/\/+$/, "");
    if (fp.startsWith(base + "/")) rmSync(fp, { force: true });
  }

  return NextResponse.json({ ok: true });
}

const DEFAULT_TEMPLATE = `---
dayOfWeek: $date("dddd")
---

- What happened today?
  - {Q1.answer}
- How did I feel?
  - {Q2.answer}
- What's one small adjustment?
  - {Q3.answer}`;