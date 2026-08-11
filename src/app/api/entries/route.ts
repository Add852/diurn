import { NextRequest, NextResponse } from "next/server";
import { getDb, getActiveProfile, getProfileQuestions, getStreakCount, type ProfileQuestion } from "@/lib/db";
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
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");
  const streakOnly = url.searchParams.get("streak") === "1";
  const date = url.searchParams.get("date");
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

  if (date) {
    query += profile ? " AND" : " WHERE";
    query += " date = ?";
    params.push(date);
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
      if (date && dateMatch[1] !== date) continue;

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

  const { session_id, date, overwrite } = await req.json();
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
  const messages = getMessages(session_id);
  const msgs = messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content }));

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  const questions = getProfileQuestions(profile.id);
  let allUserInput = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");
  const config = llmConfig(profile);

  const systemMsg = msgs.filter((m) => m.role === "system").slice(0, 1);
  const answers: Record<string, TemplateVar> = {};

  if (questions.length > 0) {
    const shape = `{ ${questions.map((q) => `"${q.identifier}": "<answer>"`).join(", ")} }`;
    const batchPrompt = `Based on ALL of the user's input below, answer each question.

User input:
${allUserInput}

${questions.map((q) => `Question "${q.identifier}" — ${q.question}\nInstructions: ${q.answer_prompt}`).join("\n\n")}

Respond with ONLY valid JSON in exactly this shape, no text outside it:
${shape}`;
    try {
      const raw = await chatCompletion(config, [...systemMsg, { role: "user", content: batchPrompt }], 60000);
      // LLM JSON is untrusted: keys are validated per-question below.
      const parsed: unknown = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        for (const q of questions) {
          const value = rec[q.identifier];
          answers[q.identifier] = { question: q.question, answer: typeof value === "string" ? value.trim() : "", asked: !!q.asked, prompt: q.answer_prompt || "" };
        }
      }
    } catch {}
  }

  // Fallback: ask individually for anything the batch call didn't answer.
  const missing = questions.filter((q) => !answers[q.identifier]?.answer);
  if (missing.length > 0) {
    const ask = async (q: ProfileQuestion) => {
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
    const pairs = await Promise.all(missing.map(ask));
    for (const [id, kv] of pairs) {
      const t = answers[id];
      if (t) t.answer = kv.answer;
    }
  }

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
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Keep the Obsidian note in sync with the edit (same atomic write as POST).
  let filePath: string | null = null;
  if (profile.daily_note_folder) {
    filePath = join(profile.daily_note_folder, `${date}.md`);
    const dir = profile.daily_note_folder;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, markdown, "utf-8");
    renameSync(tmp, filePath);
  }

  db.prepare("UPDATE entries SET rendered_markdown = ?, file_path = ? WHERE id = ?").run(
    markdown,
    filePath,
    existing.id
  );
  return NextResponse.json({ ok: true, id: existing.id, file_path: filePath });
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
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  db.prepare("DELETE FROM entries WHERE id = ?").run(existing.id);

  // Only remove the note file when it lives under the configured notes folder —
  // never delete a path the app didn't create.
  const fp = existing.file_path;
  if (fp && profile.daily_note_folder) {
    const base = profile.daily_note_folder.replace(/\/+$/, "");
    if (fp.startsWith(base + "/")) rmSync(fp, { force: true });
  }

  return NextResponse.json({ ok: true });
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