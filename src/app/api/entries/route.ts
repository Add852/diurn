import { NextRequest, NextResponse } from "next/server";
import { getDb, getActiveProfile, getProfileQuestions, getStreakCount } from "@/lib/db";
import { chatCompletion } from "@/lib/ai";
import { renderTemplate } from "@/lib/template";
import { loadMediaContext } from "@/lib/media-cache";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join, extname } from "path";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");
  const streakOnly = url.searchParams.get("streak") === "1";
  const profile = getActiveProfile();
  const db = getDb();

  if (streakOnly && profile) {
    return NextResponse.json({ streak: getStreakCount(profile.id) });
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

  query += " ORDER BY date DESC";
  const dbEntries = db.prepare(query).all(...params) as any[];

  const seenDates = new Set(dbEntries.map((e) => e.date));
  let fsOnlyId = 0;

  if (profile?.daily_note_folder && existsSync(profile.daily_note_folder)) {
    const files = readdirSync(profile.daily_note_folder).filter((f) => extname(f) === ".md");
    for (const file of files) {
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!dateMatch) continue;
      const date = dateMatch[1];
      if (seenDates.has(date)) continue;
      if (month && year && !date.startsWith(`${year}-${String(month).padStart(2, "0")}`)) continue;

      try {
        const content = readFileSync(join(profile.daily_note_folder, file), "utf-8");
        seenDates.add(date);
        dbEntries.push({
          id: -(++fsOnlyId),
          date,
          rendered_markdown: content,
          file_path: join(profile.daily_note_folder, file),
          profile_id: profile.id,
          _fs_only: true,
        });
      } catch {}
    }
  }

dbEntries.sort((a, b) => b.date.localeCompare(a.date));
  return NextResponse.json(dbEntries);
}

export async function POST(req: NextRequest) {
  const { session_id, date, overwrite } = await req.json();
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const db = getDb();

  const existing = db.prepare("SELECT id FROM entries WHERE profile_id = ? AND date = ?").get(profile.id, date);
  if (existing && !overwrite) {
    return NextResponse.json({ exists: true, error: "Entry already exists for this date" }, { status: 409 });
  }

  if (overwrite && existing) {
    db.prepare("DELETE FROM entry_answers WHERE entry_id = ?").run((existing as any).id);
    db.prepare("DELETE FROM entries WHERE id = ?").run((existing as any).id);
  }
  const messages = db
    .prepare("SELECT role, content FROM conversation_messages WHERE session_id = ? ORDER BY id")
    .all(session_id) as { role: string; content: string }[];
  const msgs = messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content }));

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  const questions = getProfileQuestions(profile.id) as any[];
  let allUserInput = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");

  const mediaFiles: string[] = [];
  if (profile.media_enabled && profile.media_folder && existsSync(profile.media_folder)) {
    const entries = await loadMediaContext(profile.id, profile.media_folder, profile.timezone, date, 10);
    for (const e of entries) mediaFiles.push(e.name);
    if (mediaFiles.length > 0) {
      allUserInput += `\n\nMedia files from today: ${mediaFiles.slice(0, 10).join(", ")}`;
    }
  }

  const config = { endpoint: profile.llm_endpoint, apiKey: profile.llm_api_key, model: profile.llm_model };

  const systemMsg = msgs.filter((m) => m.role === "system").slice(0, 1);
  const answers: Record<string, { question: string; answer: string }> = {};

  const ask = async (q: any) => {
    const prompt = `Based on ALL of the user's input below, answer this:

User input:
${allUserInput}

For this question: "${q.question}"
Instructions: ${q.answer_prompt}

Provide ONLY the answer, no extra text. Keep under 3 lines.`;
    try {
      const answer = await chatCompletion(config, [
        ...systemMsg,
        { role: "user", content: prompt },
      ], 45000);
      return [q.identifier, { question: q.question, answer }] as const;
    } catch {
      return [q.identifier, { question: q.question, answer: "" }] as const;
    }
  };

  const pairs = await Promise.all(questions.map(ask));
  for (const [id, v] of pairs) answers[id] = v;

  let templateContent = "";
  if (profile.template_note_path && existsSync(profile.template_note_path)) {
    templateContent = readFileSync(profile.template_note_path, "utf-8");
  } else {
    templateContent = DEFAULT_TEMPLATE;
  }

  const d = new Date(date + "T00:00:00");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const rendered = renderTemplate(templateContent, answers, {
    date,
    day_of_week: days[d.getDay()] || "Unknown",
    day_number: String(d.getDate()),
  });

  let filePath = "";
  if (profile.daily_note_folder) {
    filePath = join(profile.daily_note_folder, `${date}.md`);
    const dir = profile.daily_note_folder;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, rendered, "utf-8");
    renameSync(tmp, filePath);
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

  return NextResponse.json({ entry_id: entryId, file_path: filePath, rendered, answers });
}

const DEFAULT_TEMPLATE = `---
dayOfWeek: {day_of_week}
---

- What happened today?
  - {Q1.answer}
- How did I feel?
  - {Q2.answer}
- What's one small adjustment?
  - {Q3.answer}`;