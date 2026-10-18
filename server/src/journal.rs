//! GET /api/entries — port of src/app/api/entries/route.ts GET (read side):
//! entries table merged with fs-only {date}.md files from daily_note_folder.

use std::{
    path::{Path, PathBuf},
};

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

// --- form + write path (no-AI port of /api/form + entries POST/PUT/DELETE) ---

pub fn is_valid_date(s: &str) -> bool {
    s.len() == 10
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[7] == b'-'
        && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// Port of timezone.ts localDate: shift by day_offset, format in profile tz
/// (UTC fallback when the tz name is unknown).
pub fn local_date(now_ms: i64, tz: &str, offset_hours: i64) -> String {
    use chrono::TimeZone;
    let shifted = now_ms - offset_hours * 3_600_000;
    let utc = chrono::Utc.timestamp_millis_opt(shifted).single();
    let in_tz = tz
        .parse::<chrono_tz::Tz>()
        .ok()
        .zip(utc)
        .map(|(tz, u)| u.with_timezone(&tz).format("%Y-%m-%d").to_string());
    in_tz.unwrap_or_else(|| {
        utc.map(|u| u.format("%Y-%m-%d").to_string())
            .unwrap_or_default()
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct FormQuestion {
    pub identifier: String,
    pub question: String,
    pub answer_prompt: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct FormInfo {
    pub date: String,
    pub questions: Vec<FormQuestion>,
    pub ask_mode: String,
    pub form_output: String,
}

/// GET /api/form — no-AI subset: date + asked questions + mode flags.
pub fn form(conn: &rusqlite::Connection, profile: &Profile, now_ms: i64) -> Option<FormInfo> {
    let mut stmt = conn
        .prepare(
            "SELECT identifier, question, answer_prompt FROM profile_questions
             WHERE profile_id = ?1 AND asked = 1 ORDER BY sort_order",
        )
        .ok()?;
    let questions = stmt
        .query_map(rusqlite::params![profile.id], |r| {
            Ok(FormQuestion {
                identifier: r.get(0)?,
                question: r.get(1)?,
                answer_prompt: r.get(2)?,
            })
        })
        .ok()?
        .flatten()
        .collect::<Vec<_>>();
    if questions.is_empty() {
        return None;
    }
    Some(FormInfo {
        date: local_date(now_ms, &profile.timezone, profile.day_offset_hours),
        questions,
        ask_mode: "separate".into(),
        form_output: "raw".into(),
    })
}

/// Atomic tmp+rename write of {date}.md (port of writeNote).
pub fn write_note(dir: &Path, date: &str, content: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let file_path = dir.join(format!("{date}.md"));
    let tmp = file_path.with_extension("md.tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, &file_path)?;
    Ok(file_path)
}

pub enum CreateError {
    InvalidDate,
    Exists,
    Db(String),
}

pub struct Created {
    pub entry_id: i64,
    pub file_path: Option<String>,
    pub rendered: String,
}

/// POST /api/entries (form, no-AI): verbatim answers -> template -> file+rows.
pub fn create_entry(
    conn: &mut rusqlite::Connection,
    profile: &Profile,
    date: &str,
    overwrite: bool,
    answers_in: &std::collections::HashMap<String, String>,
) -> Result<Created, CreateError> {
    if !is_valid_date(date) {
        return Err(CreateError::InvalidDate);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM entries WHERE profile_id = ?1 AND date = ?2",
            rusqlite::params![profile.id, date],
            |r| r.get(0),
        )
        .ok();
    if existing.is_some() && !overwrite {
        return Err(CreateError::Exists);
    }
    if let Some(id) = existing {
        let _ = conn.execute("DELETE FROM entries WHERE id = ?1", rusqlite::params![id]);
    }

    let template = if !profile.template_note_path.is_empty()
        && Path::new(&profile.template_note_path).is_file()
    {
        std::fs::read_to_string(&profile.template_note_path).unwrap_or_default()
    } else {
        crate::template::default_template().to_string()
    };

    // All questions get slots (empty when unanswered) so the rendered note
    // never shows literal {X.answer} tokens. ponytail: old app leaves literal
    // tokens for unanswered questions when AI is off — this is friendlier.
    let mut vars = std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT identifier, question, answer_prompt, asked FROM profile_questions
                 WHERE profile_id = ?1 ORDER BY sort_order",
            )
            .map_err(|e| CreateError::Db(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![profile.id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| CreateError::Db(e.to_string()))?;
        for (identifier, question, prompt, asked) in rows.flatten() {
            let answer = answers_in.get(&identifier).map(|s| s.trim()).unwrap_or("");
            vars.insert(
                identifier,
                crate::template::TemplateVar {
                    question,
                    answer: answer.to_string(),
                    asked: asked != 0,
                    prompt,
                },
            );
        }
    }

    let rendered = crate::template::render_template(&template, &vars, chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap());

    let file_path = if !profile.daily_note_folder.is_empty() {
        write_note(Path::new(&profile.daily_note_folder), date, &rendered)
            .map(|p| p.to_string_lossy().into_owned())
            .ok()
    } else {
        None
    };

    let tx = conn.transaction().map_err(|e| CreateError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO entries (profile_id, date, rendered_markdown, file_path) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![profile.id, date, rendered, file_path],
    )
    .map_err(|e| CreateError::Db(e.to_string()))?;
    let entry_id = tx.last_insert_rowid();
    {
        let mut stmt = tx
            .prepare("SELECT id, identifier FROM profile_questions WHERE profile_id = ?1")
            .map_err(|e| CreateError::Db(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![profile.id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| CreateError::Db(e.to_string()))?;
        for (qid, identifier) in rows.flatten() {
            if let Some(a) = answers_in.get(&identifier) {
                if !a.trim().is_empty() {
                    let _ = tx.execute(
                        "INSERT INTO entry_answers (entry_id, question_id, answer_text) VALUES (?1, ?2, ?3)",
                        rusqlite::params![entry_id, qid, a.trim()],
                    );
                }
            }
        }
    }
    tx.commit().map_err(|e| CreateError::Db(e.to_string()))?;

    Ok(Created { entry_id, file_path, rendered })
}

pub enum UpdateError {
    InvalidDate,
    NotFound,
    Db(String),
}

/// PUT /api/entries: rewrite the note file (adopting fs-only entries) + DB row.
pub fn update_entry(
    conn: &rusqlite::Connection,
    profile: &Profile,
    date: &str,
    markdown: &str,
) -> Result<(i64, Option<String>), UpdateError> {
    if !is_valid_date(date) {
        return Err(UpdateError::InvalidDate);
    }
    if markdown.trim().is_empty() {
        return Err(UpdateError::NotFound);
    }
    let existing: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT id, file_path FROM entries WHERE profile_id = ?1 AND date = ?2",
            rusqlite::params![profile.id, date],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let note_path = if profile.daily_note_folder.is_empty() {
        None
    } else {
        Some(Path::new(&profile.daily_note_folder).join(format!("{date}.md")))
    };
    let fs_only = existing.is_none() && note_path.as_ref().is_some_and(|p| p.is_file());
    if existing.is_none() && !fs_only {
        return Err(UpdateError::NotFound);
    }

    let file_path = note_path
        .as_ref()
        .and_then(|p| write_note(p.parent().unwrap(), date, markdown).ok())
        .map(|p| p.to_string_lossy().into_owned());

    if let Some((id, _)) = existing {
        conn.execute(
            "UPDATE entries SET rendered_markdown = ?1, file_path = ?2 WHERE id = ?3",
            rusqlite::params![markdown, file_path, id],
        )
        .map_err(|e| UpdateError::Db(e.to_string()))?;
        Ok((id, file_path))
    } else {
        conn.execute(
            "INSERT INTO entries (profile_id, date, rendered_markdown, file_path) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![profile.id, date, markdown, file_path],
        )
        .map_err(|e| UpdateError::Db(e.to_string()))?;
        Ok((conn.last_insert_rowid(), file_path))
    }
}

/// DELETE /api/entries?date= — drop the DB row; remove the note file only
/// when it lives under the configured notes folder.
pub fn delete_entry(
    conn: &rusqlite::Connection,
    profile: &Profile,
    date: &str,
) -> Result<bool, UpdateError> {
    if !is_valid_date(date) {
        return Err(UpdateError::InvalidDate);
    }
    let existing: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT id, file_path FROM entries WHERE profile_id = ?1 AND date = ?2",
            rusqlite::params![profile.id, date],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let note_path = if profile.daily_note_folder.is_empty() {
        None
    } else {
        Some(Path::new(&profile.daily_note_folder).join(format!("{date}.md")))
    };
    let fs_only = existing.is_none() && note_path.as_ref().is_some_and(|p| p.is_file());
    if existing.is_none() && !fs_only {
        return Ok(false);
    }
    if let Some((id, _)) = existing {
        conn.execute("DELETE FROM entries WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| UpdateError::Db(e.to_string()))?;
    }
    let base = profile.daily_note_folder.trim_end_matches('/');
    let fp = existing
        .and_then(|(_, fp)| fp)
        .or_else(|| note_path.map(|p| p.to_string_lossy().into_owned()));
    if let Some(fp) = fp {
        if !base.is_empty() && fp.starts_with(&format!("{base}/")) {
            let _ = std::fs::remove_file(&fp);
        }
    }
    Ok(true)
}
