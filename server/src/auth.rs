//! Auth: single admin user (shared users table with the old app), scrypt
//! password verification, HTTP Basic credentials on every request.
//! Port of src/lib/auth.ts hashPassword/verifyPassword + the setup flow.

use std::collections::HashSet;

use rusqlite::Connection;

use crate::db::Db;

pub fn has_users(conn: &Connection) -> bool {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM users)", [], |r| r.get::<_, i64>(0))
        .map(|n| n != 0)
        .unwrap_or(false)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("getrandom");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Node scryptSync defaults: N=16384 (log_n 14), r=8, p=1, 64-byte key.
/// Salt is the hex STRING, used as raw bytes — must match the old hashes.
fn scrypt_key(password: &str, salt_hex: &str) -> [u8; 64] {
    let params = scrypt::Params::new(14, 8, 1, 64).expect("scrypt params");
    let mut out = [0u8; 64];
    scrypt::scrypt(password.as_bytes(), salt_hex.as_bytes(), &params, &mut out)
        .expect("scrypt");
    out
}

pub fn hash_password(password: &str) -> (String, String) {
    let salt = random_hex(16);
    let key = scrypt_key(password, &salt);
    let hash: String = key.iter().map(|b| format!("{b:02x}")).collect();
    (hash, salt)
}

/// ponytail: plain == compare; timing side-channels need `subtle` when this
/// faces the internet instead of a LAN.
pub fn verify_password(password: &str, hash_hex: &str, salt_hex: &str) -> bool {
    let key = scrypt_key(password, salt_hex);
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    hex == hash_hex
}

/// POST /api/auth/setup — first-run: create admin + Default profile.
pub fn setup(conn: &mut Connection, password: &str, timezone: &str) -> Result<(), String> {
    if password.len() < 4 {
        return Err("Password must be at least 4 characters".into());
    }
    let tz = if !timezone.is_empty()
        && timezone
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '/' || c == '+' || c == '-')
    {
        timezone
    } else {
        "UTC"
    };
    if has_users(conn) {
        return Err("Already set up".into());
    }
    let (hash, salt) = hash_password(password);
    const PERSONALITY: &str = "You are a thoughtful daily journaling companion. You help the user reflect on their day with warmth and directness. Ask questions to capture the day's texture — concise, natural, no therapy-fluff. No bullet points in conversation — save those for notes.";
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO users (username, password_hash, salt) VALUES ('admin', ?1, ?2)",
        rusqlite::params![hash, salt],
    )
    .map_err(|e| e.to_string())?;
    let user_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO profiles (user_id, name, is_default, is_active, llm_endpoint, llm_model, personality_prompt, ui_mode, ask_mode, timezone)
         VALUES (?1, 'Default', 1, 1, '', '', ?2, 'chat', 'all', ?3)",
        rusqlite::params![user_id, PERSONALITY, tz],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// POST /api/auth/verify — are these credentials valid? (the login check)
pub fn verify_credentials(conn: &Connection, username: &str, password: &str) -> bool {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT password_hash, salt FROM users WHERE username = ?1",
            rusqlite::params![username],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((hash, salt)) = row else { return false };
    verify_password(password, &hash, &salt)
}

/// PUT /api/auth/account — change the admin's username and/or password.
pub fn update_account(
    conn: &Connection,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    let user_id: i64 = conn
        .query_row("SELECT id FROM users ORDER BY id LIMIT 1", [], |r| r.get(0))
        .map_err(|_| "No user exists".to_string())?;
    if let Some(u) = username {
        let u = u.trim();
        if u.is_empty() {
            return Err("Username is required".into());
        }
        conn.execute(
            "UPDATE users SET username = ?1 WHERE id = ?2",
            rusqlite::params![u, user_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(p) = password {
        if p.len() < 4 {
            return Err("Password must be at least 4 characters".into());
        }
        let (hash, salt) = hash_password(p);
        conn.execute(
            "UPDATE users SET password_hash = ?1, salt = ?2 WHERE id = ?3",
            rusqlite::params![hash, salt, user_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// POST /api/auth/reset — restore everything to factory defaults:
/// profile fields, questions, media cache, and the admin account (admin/root).
/// Journal entries and the markdown files on disk are NOT touched.
pub fn reset_defaults(conn: &mut Connection) -> Result<(), String> {
    let (hash, salt) = hash_password("root");
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE users SET username = 'admin', password_hash = ?1, salt = ?2",
        rusqlite::params![hash, salt],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE profiles SET name = 'Default', daily_note_folder = '',
         template_note_path = '', media_folder = '', timezone = 'UTC', day_offset_hours = 0",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profile_questions", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM media_cache", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Auth check for the middleware. `presented` is the base64(user:pass)
/// credential string (from the Basic header or the ?auth= media fallback).
/// `verified` is the process-wide memo cache — scrypt runs once per credential.
pub fn is_authorized(
    conn: &Connection,
    verified: &mut HashSet<String>,
    presented: Option<&str>,
) -> bool {
    let Some(cred) = presented else {
        // Open before setup so a fresh install can bootstrap.
        return !has_users(conn);
    };
    if verified.contains(cred) {
        return true;
    }
    use base64::Engine as _;
    let decoded = match base64::engine::general_purpose::STANDARD.decode(cred) {
        Ok(d) => String::from_utf8(d).unwrap_or_default(),
        Err(_) => return false,
    };
    let Some((username, password)) = decoded.split_once(':') else {
        return false;
    };
    if verify_credentials(conn, username, password) {
        verified.insert(cred.to_string());
        true
    } else {
        false
    }
}


/// Auth mode for the client's connect screen, plus a username hint so the
/// form prefills the actual admin name instead of assuming 'admin'.
pub fn status(conn: &Connection) -> serde_json::Value {
    if !has_users(conn) {
        return serde_json::json!({ "needs_setup": true, "mode": "setup" });
    }
    let username: String = conn
        .query_row("SELECT username FROM users ORDER BY id LIMIT 1", [], |r| r.get(0))
        .unwrap_or_else(|_| "admin".into());
    serde_json::json!({ "needs_setup": false, "mode": "password", "username": username })
}
