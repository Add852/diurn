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

// --- settings (no-AI slice of /api/settings) ---

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SettingsProfile {
    pub id: i64,
    pub name: String,
    pub daily_note_folder: String,
    pub template_note_path: String,
    pub media_folder: String,
    pub timezone: String,
    pub day_offset_hours: i64,
    pub theme_mode: String,
    pub accent_color: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SettingsQuestion {
    pub id: i64,
    pub identifier: String,
    pub question: String,
    pub answer_prompt: String,
    pub asked: bool,
    pub sort_order: i64,
}

pub fn get_settings(
    conn: &rusqlite::Connection,
    profile: &Profile,
) -> rusqlite::Result<serde_json::Value> {
    let username: String = conn
        .query_row("SELECT username FROM users ORDER BY id LIMIT 1", [], |r| r.get(0))
        .unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT id, identifier, question, answer_prompt, asked, sort_order
         FROM profile_questions WHERE profile_id = ?1 ORDER BY sort_order",
    )?;
    let questions = stmt
        .query_map(rusqlite::params![profile.id], |r| {
            Ok(SettingsQuestion {
                id: r.get(0)?,
                identifier: r.get(1)?,
                question: r.get(2)?,
                answer_prompt: r.get(3)?,
                asked: r.get::<_, i64>(4)? != 0,
                sort_order: r.get(5)?,
            })
        })?
        .flatten()
        .collect::<Vec<_>>();
    let template_content = if profile.template_note_path.is_empty() {
        String::new()
    } else {
        std::fs::read_to_string(&profile.template_note_path).unwrap_or_default()
    };
    Ok(serde_json::json!({
        "user": { "username": username },
        "profile": SettingsProfile {
            id: profile.id,
            name: profile.name.clone(),
            daily_note_folder: profile.daily_note_folder.clone(),
            template_note_path: profile.template_note_path.clone(),
            media_folder: profile.media_folder.clone(),
            timezone: profile.timezone.clone(),
            day_offset_hours: profile.day_offset_hours,
            theme_mode: profile.theme_mode.clone(),
            accent_color: profile.accent_color.clone(),
        },
        "questions": questions,
        "template_content": template_content,
    }))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProfileIn {
    pub name: Option<String>,
    pub daily_note_folder: Option<String>,
    pub template_note_path: Option<String>,
    pub media_folder: Option<String>,
    pub timezone: Option<String>,
    pub day_offset_hours: Option<i64>,
    pub theme_mode: Option<String>,
    pub accent_color: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QuestionIn {
    pub id: Option<i64>,
    pub identifier: String,
    pub question: String,
    #[serde(default)]
    pub answer_prompt: String,
    #[serde(default = "default_true")]
    pub asked: bool,
    #[serde(default)]
    pub sort_order: i64,
}

fn default_true() -> bool {
    true
}

fn is_hex_color(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

fn assert_dir(field: &str, v: &str) -> Result<(), String> {
    let t = v.trim();
    if t.is_empty() {
        return Ok(());
    }
    let p = Path::new(t);
    if !p.is_dir() {
        return Err(format!("Folder not found for {field}: {t}"));
    }
    Ok(())
}

pub enum UpdateError {
    InvalidDate,
    NotFound,
    Db(String),
}

/// PUT /api/settings — whitelisted profile cols + questions upsert (preserves
/// ids so entry_answers FKs survive) + media cache invalidation on bucketing
/// changes. AI/integration/export fields are out of scope for now.
pub fn put_settings(
    conn: &mut rusqlite::Connection,
    profile_id: i64,
    p: &ProfileIn,
    questions: Option<&Vec<QuestionIn>>,
    template_content: Option<&str>,
) -> Result<(), String> {
    let current: (String, String, String, i64, String, String, String) = conn
        .query_row(
            "SELECT daily_note_folder, template_note_path, media_folder, day_offset_hours, timezone, theme_mode, accent_color
             FROM profiles WHERE id = ?1",
            rusqlite::params![profile_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .map_err(|_| "Profile not found".to_string())?;

    let daily = p.daily_note_folder.clone().unwrap_or_else(|| current.0.clone());
    let template = p.template_note_path.clone().unwrap_or_else(|| current.1.clone());
    let media_folder = p.media_folder.clone().unwrap_or_else(|| current.2.clone());
    let day_offset = p.day_offset_hours.unwrap_or(current.3).clamp(0, 24);
    let timezone = p.timezone.clone().unwrap_or_else(|| current.4.clone());
    let mut theme_mode = p.theme_mode.clone().unwrap_or(current.5);
    if !matches!(theme_mode.as_str(), "system" | "dark" | "light") {
        theme_mode = "system".into();
    }
    let mut accent_color = p.accent_color.clone().unwrap_or(current.6);
    if !is_hex_color(&accent_color) {
        accent_color = "#22c55e".into();
    }

    // Filesystem validation (empty = unset, allowed)
    assert_dir("Daily note folder", &daily)?;
    assert_dir("Media folder", &media_folder)?;
    let template = template.trim().to_string();
    if !template.is_empty() {
        let tp = Path::new(&template);
        let ext = tp.extension().map(|e| e.to_string_lossy().to_lowercase());
        if ext.as_deref() != Some("md") {
            return Err(format!("Template note path must be a .md file: {template}"));
        }
        // The file must exist only when we're NOT (re)creating it below.
        if template_content.is_none() && !tp.is_file() {
            return Err(format!("Template note path must be a .md file: {template}"));
        }
    }

    // Template content edit: atomic write to the configured file (create ok).
    if let Some(content) = template_content {
        if template.is_empty() {
            return Err("Set the template note path before editing its content".into());
        }
        let tp = Path::new(&template);
        if let Some(parent) = tp.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let tmp = tp.with_extension("md.tmp");
        std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, tp).map_err(|e| e.to_string())?;
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE profiles SET name = ?1, daily_note_folder = ?2, template_note_path = ?3,
         media_folder = ?4, day_offset_hours = ?5, timezone = ?6, theme_mode = ?7, accent_color = ?8
         WHERE id = ?9",
        rusqlite::params![
            p.name.clone().unwrap_or_default(),
            daily,
            template,
            media_folder,
            day_offset,
            timezone,
            theme_mode,
            accent_color,
            profile_id
        ],
    )
    .map_err(|e| e.to_string())?;

    if let Some(qs) = questions {
        let mut keep_ids: Vec<i64> = Vec::new();
        for q in qs {
            if !q.identifier.trim().is_empty() && q.question.trim().is_empty() {
                return Err(format!("Question text is required for {}", q.identifier));
            }
            match q.id {
                Some(id) => {
                    tx.execute(
                        "UPDATE profile_questions SET identifier = ?1, question = ?2,
                         answer_prompt = ?3, asked = ?4, sort_order = ?5
                         WHERE id = ?6 AND profile_id = ?7",
                        rusqlite::params![
                            q.identifier,
                            q.question,
                            q.answer_prompt,
                            q.asked as i64,
                            q.sort_order,
                            id,
                            profile_id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    keep_ids.push(id);
                }
                None => {
                    tx.execute(
                        "INSERT INTO profile_questions (profile_id, identifier, question, answer_prompt, asked, sort_order)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            profile_id,
                            q.identifier,
                            q.question,
                            q.answer_prompt,
                            q.asked as i64,
                            q.sort_order
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    // the not-in delete below must not eat the row we just made
                    keep_ids.push(tx.last_insert_rowid());
                }
            }
        }
        // delete questions removed client-side
        if !keep_ids.is_empty() {
            let placeholders = keep_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            tx.execute(
                &format!(
                    "DELETE FROM profile_questions WHERE profile_id = ? AND id NOT IN ({placeholders})"
                ),
                rusqlite::params_from_iter(
                    std::iter::once(profile_id).chain(keep_ids.iter().copied()),
                ),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Media bucketing changed -> drop cached rows; next /api/media rescans.
    if day_offset != current.3 || timezone != current.4 || media_folder != current.2 {
        tx.execute(
            "DELETE FROM media_cache WHERE profile_id = ?1",
            rusqlite::params![profile_id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())
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
