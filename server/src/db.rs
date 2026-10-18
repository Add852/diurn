//! SQLite access — shares ~/.diurn/data.db with the old Next.js app:
//! same file, same schema, same thumbs layout. No data migration needed.

use std::{path::Path, sync::Mutex};

use rusqlite::Connection;

pub const SCHEMA: &str = include_str!("schema.sql");

/// The old app migrates existing tables with column-level ALTERs on startup
/// (db.ts migrateProfileColumns/migrateMediaCacheColumns) — CREATE IF NOT
/// EXISTS can't add columns to tables from older schema versions, so mirror
/// that here for every column the Rust code touches.
fn migrate_columns(conn: &Connection) {
    let _ = ensure_columns(
        conn,
        "media_cache",
        &[
            ("date", "TEXT"),
            ("captured_at", "INTEGER"),
            ("type", "TEXT NOT NULL DEFAULT 'image'"),
            ("mtime", "INTEGER NOT NULL DEFAULT 0"),
            ("thumb", "TEXT"),
            ("scanned_at", "TEXT"),
        ],
    );
    let _ = ensure_columns(
        conn,
        "profiles",
        &[
            ("name", "TEXT NOT NULL DEFAULT ''"),
            ("daily_note_folder", "TEXT NOT NULL DEFAULT ''"),
            ("template_note_path", "TEXT NOT NULL DEFAULT ''"),
            ("media_enabled", "INTEGER NOT NULL DEFAULT 0"),
            ("media_folder", "TEXT NOT NULL DEFAULT ''"),
            ("timezone", "TEXT NOT NULL DEFAULT 'UTC'"),
            ("day_offset_hours", "INTEGER NOT NULL DEFAULT 0"),
        ],
    );
    let _ = ensure_columns(
        conn,
        "entries",
        &[
            ("date", "TEXT NOT NULL DEFAULT ''"),
            ("rendered_markdown", "TEXT NOT NULL DEFAULT ''"),
            ("file_path", "TEXT"),
        ],
    );
    let _ = ensure_columns(
        conn,
        "profile_questions",
        &[
            ("identifier", "TEXT NOT NULL DEFAULT ''"),
            ("question", "TEXT NOT NULL DEFAULT ''"),
            ("answer_prompt", "TEXT NOT NULL DEFAULT ''"),
            ("asked", "INTEGER NOT NULL DEFAULT 1"),
            ("sort_order", "INTEGER NOT NULL DEFAULT 0"),
        ],
    );
}

fn ensure_columns(
    conn: &Connection,
    table: &str,
    cols: &[(&str, &str)],
) -> rusqlite::Result<()> {
    let existing: Vec<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(1))?
            .flatten()
            .collect();
        names
    };
    for (col, decl) in cols {
        if !existing.iter().any(|c| c == col) {
            conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"), [])?;
        }
    }
    Ok(())
}

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Db> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        migrate_columns(&conn);
        Ok(Db(Mutex::new(conn)))
    }

    pub fn active_profile(&self) -> Option<Profile> {
        let conn = self.0.lock().ok()?;
        conn.query_row(
            "SELECT id, name, daily_note_folder, template_note_path, media_folder, timezone, day_offset_hours
             FROM profiles WHERE is_active = 1 LIMIT 1",
            [],
            |r| {
                Ok(Profile {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    daily_note_folder: r.get(2)?,
                    template_note_path: r.get(3)?,
                    media_folder: r.get(4)?,
                    timezone: r.get(5)?,
                    day_offset_hours: r.get(6)?,
                })
            },
        )
        .ok()
    }
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub daily_note_folder: String,
    pub template_note_path: String,
    pub media_folder: String,
    pub timezone: String,
    pub day_offset_hours: i64,
}
