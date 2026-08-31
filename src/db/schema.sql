CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
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
  llm_endpoint TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
  llm_model TEXT NOT NULL DEFAULT 'llama3.2',
  llm_api_key TEXT NOT NULL DEFAULT '',
  personality_prompt TEXT NOT NULL DEFAULT '',
  asking_method TEXT NOT NULL DEFAULT 'ask_in_one_go',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profile_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  question TEXT NOT NULL,
  answer_prompt TEXT NOT NULL,
  asked INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  rendered_markdown TEXT NOT NULL,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entry_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES profile_questions(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS media_cache (
  path TEXT NOT NULL,
  profile_id INTEGER NOT NULL,
  date TEXT,
  captured_at INTEGER,
  type TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (path, profile_id)
);