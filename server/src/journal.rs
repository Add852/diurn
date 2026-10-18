//! GET /api/entries — port of src/app/api/entries/route.ts GET (read side):
//! entries table merged with fs-only {date}.md files from daily_note_folder.

use std::path::Path;

use serde::Serialize;

use crate::db::Profile;

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct Entry {
    pub id: i64,
    pub date: String,
    pub rendered_markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(rename = "_fs_only", skip_serializing_if = "Option::is_none")]
    pub fs_only: Option<bool>,
}

pub fn list_entries(
    conn: &rusqlite::Connection,
    profile: &Profile,
    year_month: Option<&str>,
    date_filter: Option<&str>,
) -> Vec<Entry> {
    let mut sql = String::from(
        "SELECT id, date, rendered_markdown, file_path FROM entries WHERE profile_id = ?1",
    );
    if year_month.is_some() {
        sql.push_str(" AND strftime('%Y-%m', date) = ?2");
    }
    if date_filter.is_some() {
        let idx = if year_month.is_some() { 3 } else { 2 };
        sql.push_str(&format!(" AND date = ?{idx}"));
    }
    sql.push_str(" ORDER BY date DESC");

    let mut out: Vec<Entry> = Vec::new();
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return out,
    };
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<Entry> {
        Ok(Entry {
            id: r.get(0)?,
            date: r.get(1)?,
            rendered_markdown: r.get(2)?,
            file_path: r.get(3)?,
            fs_only: None,
        })
    };
    let rows = match (year_month, date_filter) {
        (Some(ym), Some(d)) => stmt.query_map(rusqlite::params![profile.id, ym, d], map_row),
        (Some(ym), None) => stmt.query_map(rusqlite::params![profile.id, ym], map_row),
        (None, Some(d)) => stmt.query_map(rusqlite::params![profile.id, d], map_row),
        (None, None) => stmt.query_map(rusqlite::params![profile.id], map_row),
    };
    if let Ok(rows) = rows {
        out.extend(rows.flatten());
    }

    // fs-only markdown notes not yet in the DB (chat writes land in files)
    let mut fs_only_id: i64 = 0;
    if !profile.daily_note_folder.is_empty() {
        if let Ok(read_dir) = std::fs::read_dir(&profile.daily_note_folder) {
            for e in read_dir.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                let Some(date) = date_from_filename(&name) else { continue };
                if out.iter().any(|x| x.date == date) {
                    continue;
                }
                if let Some(ym) = year_month {
                    if !date.starts_with(ym) {
                        continue;
                    }
                }
                if let Some(qd) = date_filter {
                    if date != qd {
                        continue;
                    }
                }
                let Ok(content) = std::fs::read_to_string(e.path()) else { continue };
                if content.is_empty() {
                    continue;
                }
                fs_only_id -= 1;
                out.push(Entry {
                    id: fs_only_id,
                    date,
                    rendered_markdown: content,
                    file_path: Some(e.path().to_string_lossy().into_owned()),
                    fs_only: Some(true),
                });
            }
        }
    }

    out.sort_by(|a, b| b.date.cmp(&a.date));
    out
}

fn date_from_filename(name: &str) -> Option<String> {
    let base = Path::new(name).file_name()?.to_string_lossy();
    if !base.ends_with(".md") || base.len() < 13 {
        return None;
    }
    let candidate = &base[..base.len() - 3];
    let b = candidate.as_bytes();
    // ^\d{4}-\d{2}-\d{2}$
    let digits = |s: &[u8]| s.iter().all(|c| c.is_ascii_digit());
    if b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && digits(&b[0..4])
        && digits(&b[5..7])
        && digits(&b[8..10])
    {
        Some(candidate.to_string())
    } else {
        None
    }
}
