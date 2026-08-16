import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { localDate } from "@/lib/timezone";

export interface Profile {
  id: number;
  user_id: number;
  name: string;
  is_default: number;
  is_active: number;
  daily_note_folder: string;
  template_note_path: string;
  google_tasks_enabled: number;
  google_tasks_config: string;
  google_calendar_enabled: number;
  google_calendar_config: string;
  google_client_id: string;
  google_client_secret: string;
  media_enabled: number;
  media_folder: string;
  obsidian_enabled: number;
  obsidian_folder: string;
  obsidian_exclude_folders: string;
  obsidian_include_content: number;
  llm_endpoint: string;
  llm_model: string;
  llm_api_key: string;
  personality_prompt: string;
  asking_method: string;
  timezone: string;
}

const DATA_DIR = join(homedir(), ".diurn");
const DB_PATH = join(DATA_DIR, "data.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const d = new Database(DB_PATH);
  db = d;
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");

  const schema = readFileSync(join(process.cwd(), "src", "db", "schema.sql"), "utf-8");
  d.exec(schema);

  migrateProfileColumns(d);
  migrateMediaCacheColumns(d);
  migrateObsidianColumns(d);

  try {
    const hasOldFk = d.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='entry_answers' AND sql NOT LIKE '%ON DELETE CASCADE%'"
    ).get();
    if (hasOldFk) {
      try {
        d.transaction(() => {
          d.exec(`
            CREATE TABLE entry_answers_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
              question_id INTEGER NOT NULL REFERENCES profile_questions(id) ON DELETE CASCADE,
              answer_text TEXT NOT NULL
            );
            INSERT INTO entry_answers_new SELECT * FROM entry_answers;
            DROP TABLE entry_answers;
            ALTER TABLE entry_answers_new RENAME TO entry_answers;
          `);
        })();
      } catch {}
    }
  } catch {}

  return d;

}

function migrateProfileColumns(db: Database.Database) {
  const cols = new Set((db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!cols.has(name)) {
      try { db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${def}`); } catch {}
    }
  };
  add("google_client_id", "TEXT NOT NULL DEFAULT ''");
  add("google_client_secret", "TEXT NOT NULL DEFAULT ''");
  add("timezone", "TEXT NOT NULL DEFAULT 'UTC'");
}

function migrateObsidianColumns(db: Database.Database) {
  const cols = new Set((db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!cols.has(name)) {
      try { db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${def}`); } catch {}
    }
  };
  add("obsidian_enabled", "INTEGER NOT NULL DEFAULT 0");
  add("obsidian_folder", "TEXT NOT NULL DEFAULT ''");
  add("obsidian_exclude_folders", "TEXT NOT NULL DEFAULT ''");
  add("obsidian_include_content", "INTEGER NOT NULL DEFAULT 0");
}

function migrateMediaCacheColumns(db: Database.Database) {
  const cols = new Set((db.prepare("PRAGMA table_info(media_cache)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("captured_at")) {
    try {
      db.exec("ALTER TABLE media_cache ADD COLUMN captured_at INTEGER");
      db.exec(
        "UPDATE media_cache SET captured_at = CAST(strftime('%s', date || 'T12:00:00') AS INTEGER) * 1000 WHERE captured_at IS NULL"
      );
    } catch {}
  }
}

export function hasUsers(): boolean {
  return (getDb().prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }).cnt > 0;
}

export function getActiveProfile(): Profile | undefined {
  return getDb().prepare("SELECT * FROM profiles WHERE is_active = 1").get() as Profile | undefined;
}

export function getProfile(id: number): Profile | undefined {
  return getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(id) as Profile | undefined;
}

export interface ProfileQuestion {
  id: number;
  profile_id: number;
  identifier: string;
  question: string;
  answer_prompt: string;
  asked: number;
  sort_order: number;
}

export function getProfileQuestions(profileId: number): ProfileQuestion[] {
  return getDb()
    .prepare("SELECT * FROM profile_questions WHERE profile_id = ? ORDER BY sort_order")
    .all(profileId) as ProfileQuestion[];
}

export function getStreakCount(profileId: number, timezone?: string): number {
  const db = getDb();
  const rows = db
    .prepare(`SELECT DISTINCT date FROM entries WHERE profile_id = ? ORDER BY date DESC`)
    .all(profileId) as { date: string }[];

  if (rows.length === 0) return 0;

  const today = localDate(new Date(), timezone);
  const yesterday = localDate(Date.now() - 86_400_000, timezone);

  const hasToday = rows.some((r) => r.date === today);
  const hasYesterday = rows.some((r) => r.date === yesterday);

  // No entry today or yesterday -> streak broken
  if (!hasToday && !hasYesterday) return 0;

  // Start counting from today if it has entry, else from yesterday
  const startDate = hasToday ? today : yesterday;
  let streak = 1;

  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].date !== startDate) continue;
    const diff = (new Date(rows[i].date).getTime() - new Date(rows[i + 1].date).getTime()) / 86_400_000;
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

export function getStreakStatus(profileId: number, timezone?: string): { streak: number; active: boolean } {
  const db = getDb();
  const rows = db
    .prepare(`SELECT DISTINCT date FROM entries WHERE profile_id = ? ORDER BY date DESC`)
    .all(profileId) as { date: string }[];

  if (rows.length === 0) return { streak: 0, active: false };

  const today = localDate(new Date(), timezone);
  const hasToday = rows.some((r) => r.date === today);

  return { streak: getStreakCount(profileId, timezone), active: hasToday };
}