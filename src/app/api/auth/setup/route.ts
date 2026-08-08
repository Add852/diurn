import { NextRequest, NextResponse } from "next/server";
import { getDb, hasUsers } from "@/lib/db";
import { hashPassword, getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (hasUsers()) {
    return NextResponse.json({ error: "Already set up" }, { status: 403 });
  }

  const { password } = await req.json();
  if (!password || password.length < 4) {
    return NextResponse.json({ error: "Password too short" }, { status: 400 });
  }

  const { hash, salt } = hashPassword(password);
  const db = getDb();

  db.prepare(
    "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)"
  ).run("admin", hash, salt);

  const userId = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as any).id;

  db.prepare(
    `INSERT INTO profiles (user_id, name, is_default, is_active, llm_endpoint, llm_model, personality_prompt, asking_method)
     VALUES (?, ?, 1, 1, ?, ?, ?, ?)`
  ).run(
    userId,
    "Default",
    "http://localhost:20128/v1",
    "freethinkers",
    "You are a thoughtful daily journaling companion. You help the user reflect on their day with warmth and directness. Ask questions to capture the day's texture — concise, natural, no therapy-fluff. No bullet points in conversation — save those for notes.",
    "ask_in_one_go"
  );

  const profileId = (db.prepare("SELECT id FROM profiles WHERE user_id = ? AND is_default = 1").get() as any).id;

  const questions = [
    ["Q1", "What happened today?", "Summarize the user's day from today's response, blending in details about events, tasks completed, notes, or media moments. Concise bullet under 3 lines.", 1, 0],
    ["Q2", "What are your thoughts and feels?", "Distill the user's dominant feeling and what affected it. Assign a 1-5 mood rating at end based on tone.", 1, 1],
    ["Q3", "What is one small adjustment for next time?", "Extract or infer one simple action the user mentions they'd try differently.", 1, 2],
  ];

  const stmt = db.prepare(
    "INSERT INTO profile_questions (profile_id, identifier, question, answer_prompt, asked, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const q of questions) stmt.run(profileId, ...q);

  const session = await getSession();
  session.userId = userId;
  session.username = "admin";
  await session.save();

  return NextResponse.json({ userId, defaultProfileId: profileId });
}