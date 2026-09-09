import { test } from "node:test";
import assert from "node:assert/strict";

// Migration contract: an old profiles table with asking_method migrates to
// input_method (chat flows preserved), asking_method is dropped, and the six
// new columns exist with correct defaults.
test("profiles migration: asking_method -> input_method + new columns", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");

  // Old-world schema (pre-form-interface)
  db.exec(`CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    daily_note_folder TEXT NOT NULL DEFAULT '',
    template_note_path TEXT NOT NULL DEFAULT '',
    google_tasks_enabled INTEGER NOT NULL DEFAULT 0,
    google_tasks_config TEXT NOT NULL DEFAULT '{}',
    google_calendar_enabled INTEGER NOT NULL DEFAULT 0,
    google_calendar_config TEXT NOT NULL DEFAULT '{}',
    google_client_id TEXT NOT NULL DEFAULT '',
    google_client_secret TEXT NOT NULL DEFAULT '',
    day_offset_hours INTEGER NOT NULL DEFAULT 0,
    media_enabled INTEGER NOT NULL DEFAULT 0,
    media_folder TEXT NOT NULL DEFAULT '',
    obsidian_enabled INTEGER NOT NULL DEFAULT 0,
    obsidian_folder TEXT NOT NULL DEFAULT '',
    obsidian_exclude_folders TEXT NOT NULL DEFAULT '',
    obsidian_include_content INTEGER NOT NULL DEFAULT 0,
    llm_endpoint TEXT NOT NULL DEFAULT '',
    llm_model TEXT NOT NULL DEFAULT '',
    llm_api_key TEXT NOT NULL DEFAULT '',
    personality_prompt TEXT NOT NULL DEFAULT '',
    asking_method TEXT NOT NULL DEFAULT 'ask_in_one_go',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.prepare("INSERT INTO profiles (user_id, name, asking_method) VALUES (1, 'chatuser', 'one_by_one')").run();
  db.prepare("INSERT INTO profiles (user_id, name, asking_method) VALUES (1, 'batchuser', 'ask_in_one_go')").run();

  // Mirror migrateProfileColumns from src/lib/db.ts
  const cols = new Set((db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!cols.has(name)) {
      try { db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${def}`); } catch {}
    }
  };
  add("ai_enabled", "INTEGER NOT NULL DEFAULT 1");
  add("input_method", "TEXT NOT NULL DEFAULT 'form_single'");
  add("form_output", "TEXT NOT NULL DEFAULT 'raw'");
  add("media_in_context", "INTEGER NOT NULL DEFAULT 0");
  add("raw_context_enabled", "INTEGER NOT NULL DEFAULT 0");
  add("raw_context_folder", "TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE profiles SET input_method = CASE asking_method WHEN 'one_by_one' THEN 'chat_one_by_one' ELSE 'chat_one_go' END
    WHERE input_method = 'form_single' AND asking_method IS NOT NULL`);
  try { db.exec("ALTER TABLE profiles DROP COLUMN asking_method"); } catch {}

  const rows = db.prepare("SELECT name, input_method, ai_enabled, form_output FROM profiles ORDER BY id").all() as any[];
  assert.equal(rows[0].input_method, "chat_one_by_one");
  assert.equal(rows[1].input_method, "chat_one_go");
  assert.equal(rows[0].ai_enabled, 1);
  assert.equal(rows[0].form_output, "raw");
  const names = (db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map((c) => c.name);
  assert.equal(names.includes("asking_method"), false);
  assert.equal(names.includes("raw_context_folder"), true);
});
