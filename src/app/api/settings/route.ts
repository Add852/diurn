import { NextRequest, NextResponse } from "next/server";
import { getDb, getActiveProfile, getProfileQuestions } from "@/lib/db";
import { requireAuth, hashPassword, verifyPassword } from "@/lib/auth";

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const profile = getActiveProfile();
  const profiles = db.prepare("SELECT * FROM profiles ORDER BY id").all();
  const user = db.prepare("SELECT id, username FROM users LIMIT 1").get() as any;

  let questions: any[] = [];
  if (profile) {
    questions = db.prepare("SELECT * FROM profile_questions WHERE profile_id = ? ORDER BY sort_order").all(profile.id);
  }

  return NextResponse.json({ profile, profiles, questions, user: user ? { id: user.id, username: user.username } : null });
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();

  if (body.profile) {
    const p = body.profile;
    if (!p.id) {
      return NextResponse.json({ error: "Profile missing id" }, { status: 400 });
    }
    try {
db.prepare(`UPDATE profiles SET
      name=?, daily_note_folder=?, template_note_path=?,
      google_tasks_enabled=?, google_tasks_config=?, google_calendar_enabled=?,
      google_calendar_config=?, google_client_id=?, google_client_secret=?,
      media_enabled=?, media_folder=?,
      obsidian_enabled=?, obsidian_folder=?, obsidian_exclude_folders=?, obsidian_include_content=?,
      llm_endpoint=?, llm_model=?,
      llm_api_key=?, personality_prompt=?, asking_method=?, timezone=?
      WHERE id=?`).run(
      p.name, p.daily_note_folder || "", p.template_note_path || "",
      p.google_tasks_enabled ? 1 : 0, p.google_tasks_config || "{}", p.google_calendar_enabled ? 1 : 0,
      p.google_calendar_config || "{}", p.google_client_id || "", p.google_client_secret || "",
      p.media_enabled ? 1 : 0, p.media_folder || "",
      p.obsidian_enabled ? 1 : 0, p.obsidian_folder || "", p.obsidian_exclude_folders || "", p.obsidian_include_content ? 1 : 0,
      p.llm_endpoint, p.llm_model,
      p.llm_api_key || "", p.personality_prompt || "", p.asking_method || "ask_in_one_go",
      p.timezone || "UTC",
      p.id,
    );
      console.log("[settings PUT] profile updated id:", p.id);
    } catch (err: any) {
      console.error("[settings PUT] profile update failed:", err.message);
      return NextResponse.json({ error: `Profile save failed: ${err.message}` }, { status: 500 });
    }
  }

  if (body.questions) {
    const profile = getActiveProfile();
    if (!profile) return NextResponse.json({ error: "No active profile" }, { status: 400 });
    try {
      const incoming = body.questions as any[];
      const upsert = db.prepare(
        "INSERT INTO profile_questions (id, profile_id, identifier, question, answer_prompt, asked, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET identifier=excluded.identifier, question=excluded.question, answer_prompt=excluded.answer_prompt, asked=excluded.asked, sort_order=excluded.sort_order"
      );
      const insert = db.prepare(
        "INSERT INTO profile_questions (profile_id, identifier, question, answer_prompt, asked, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
      );
      db.transaction(() => {
        const keepIds: number[] = [];
        incoming.forEach((q: any, i: number) => {
          if (q.id) {
            upsert.run(q.id, profile.id, q.identifier, q.question, q.answer_prompt, q.asked ? 1 : 0, i);
            keepIds.push(q.id);
          } else {
            const r = insert.run(profile.id, q.identifier, q.question, q.answer_prompt, q.asked ? 1 : 0, i);
            keepIds.push(Number(r.lastInsertRowid));
          }
        });
        if (keepIds.length > 0) {
          const placeholders = keepIds.map(() => "?").join(",");
          db.prepare(`DELETE FROM profile_questions WHERE profile_id = ? AND id NOT IN (${placeholders})`).run(profile.id, ...keepIds);
        } else {
          db.prepare("DELETE FROM profile_questions WHERE profile_id = ?").run(profile.id);
        }
      })();
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to save questions: ${err.message}` }, { status: 500 });
    }
  }

  if (body.create_profile) {
    const user = db.prepare("SELECT id FROM users LIMIT 1").get() as any;
    if (!user) {
      return NextResponse.json({ error: "No user found. Run setup first." }, { status: 400 });
    }
    const p = body.create_profile;
    const result = db.prepare(`INSERT INTO profiles (user_id, name, is_default, is_active, llm_endpoint, llm_model, personality_prompt, asking_method)
      VALUES (?, ?, 0, 0, ?, ?, ?, ?)`).run(
      user.id, p.name, p.llm_endpoint || "http://localhost:20128/v1", p.llm_model || "freethinkers",
      p.personality_prompt || "", p.asking_method || "ask_in_one_go",
    );
    const newId = result.lastInsertRowid as number;
    const qs = body.profile_questions;
    if (qs && Array.isArray(qs)) {
      const stmt = db.prepare("INSERT INTO profile_questions (profile_id, identifier, question, answer_prompt, asked, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
      qs.forEach((q: any, i: number) => stmt.run(newId, q.identifier, q.question, q.answer_prompt, q.asked ? 1 : 0, i));
    }
    return NextResponse.json({ ok: true, id: newId });
  }

  if (body.delete_profile_id) {
    const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(body.delete_profile_id) as any;
    if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (profile.is_default) return NextResponse.json({ error: "Cannot delete default profile" }, { status: 400 });
    db.transaction(() => {
      const wasActive = profile.is_active === 1;
      db.prepare("DELETE FROM profiles WHERE id = ?").run(body.delete_profile_id);
      db.prepare("DELETE FROM profile_questions WHERE profile_id = ?").run(body.delete_profile_id);
      // Deleting the active profile would leave the app with no active profile.
      if (wasActive) {
        const next = db.prepare("SELECT id FROM profiles ORDER BY id LIMIT 1").get() as { id: number } | undefined;
        if (next) db.prepare("UPDATE profiles SET is_active = 1 WHERE id = ?").run(next.id);
      }
    })();
    return NextResponse.json({ ok: true });
  }

  if (body.set_active_profile_id) {
    db.transaction(() => {
      db.prepare("UPDATE profiles SET is_active = 0").run();
      db.prepare("UPDATE profiles SET is_active = 1 WHERE id = ?").run(body.set_active_profile_id);
    })();
    return NextResponse.json({ ok: true });
  }

  if (body.export_profile_id) {
    const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(body.export_profile_id) as any;
    if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const questions = db.prepare("SELECT * FROM profile_questions WHERE profile_id = ? ORDER BY sort_order").all(body.export_profile_id);
    return NextResponse.json({ profile, questions });
  }

  if (body.change_password) {
    const { currentPassword, newPassword } = body.change_password;
    const user = db.prepare("SELECT * FROM users LIMIT 1").get() as any;
    if (!verifyPassword(currentPassword, user.password_hash, user.salt)) {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    const { hash, salt } = hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, user.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}