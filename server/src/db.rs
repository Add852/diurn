//! SQLite access — shares ~/.diurn/data.db with the old Next.js app:
//! same file, same schema, same thumbs layout. No data migration needed.

use std::{path::Path, sync::Mutex};

use rusqlite::Connection;

pub const SCHEMA: &str = include_str!("schema.sql");

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Db> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Db(Mutex::new(conn)))
    }

    pub fn active_profile(&self) -> Option<Profile> {
        let conn = self.0.lock().ok()?;
        conn.query_row(
            "SELECT id, daily_note_folder, media_enabled, media_folder, timezone, day_offset_hours
             FROM profiles WHERE is_active = 1 LIMIT 1",
            [],
            |r| {
                Ok(Profile {
                    id: r.get(0)?,
                    daily_note_folder: r.get(1)?,
                    media_enabled: r.get::<_, i64>(2)? != 0,
                    media_folder: r.get(3)?,
                    timezone: r.get(4)?,
                    day_offset_hours: r.get(5)?,
                })
            },
        )
        .ok()
    }
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub id: i64,
    pub daily_note_folder: String,
    pub media_enabled: bool,
    pub media_folder: String,
    pub timezone: String,
    pub day_offset_hours: i64,
}
