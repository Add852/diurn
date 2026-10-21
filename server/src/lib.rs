//! diurn server — axum skeleton.
//!
//! Endpoints (JSON contract mirrors the old Next.js API routes):
//!   GET /api/fs?dir=<abs path>&filter=<media>   -> {"entries":[{name,path,isDir}]}
//!   GET /api/fs?check=<path>&kind=<media>       -> {"ok":bool,"reason"?}
//!   GET /api/media?path=<abs path>              -> file stream, Range support
//!
//! ponytail: no auth (token middleware before exposing beyond localhost),
//! no tracing layer (add tower-http trace when debugging for real),
//! /api/fs?check only validates existence/kind — root scoping is enforced
//! on read endpoints (list/media) where traversal actually matters.

use std::collections::HashSet;
use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

pub mod auth;
pub mod db;
pub mod journal;
pub mod media;
pub mod template;

use db::Db;

const MEDIA_EXTS: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif",
];

#[derive(Clone)]
pub struct AppState {
    roots: Arc<Vec<PathBuf>>,
    db: Arc<Db>,
    verified: Arc<std::sync::Mutex<HashSet<String>>>,
}

pub fn build_router(roots: Vec<PathBuf>, db: Arc<Db>) -> Router {
    // Canonicalize roots so symlinked mounts compare equal after the
    // content endpoints canonicalize the requested path (/mnt/nas →
    // /media/…): a raw root string would 403 every thumb/file request.
    let roots: Vec<PathBuf> = roots
        .into_iter()
        .map(|r| r.canonicalize().unwrap_or(r))
        .collect();
    let state = AppState {
        roots: Arc::new(roots),
        db,
        verified: Arc::new(std::sync::Mutex::new(HashSet::new())),
    };
    // /api/auth/* is public (login IS the auth); everything else is gated.
    let public = Router::new()
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/setup", post(auth_setup))
        .route("/api/auth/verify", post(auth_verify))
        .with_state(state.clone());
    let protected = Router::new()
        .route("/api/config", get(config))
        .route("/api/fs", get(fs))
        .route("/api/form", get(form))
        .route("/api/entries", get(entries).post(entries_create).put(entries_update).delete(entries_delete))
        .route("/api/settings", get(settings).put(settings_put))
        .route("/api/template-content", get(template_content))
        .route("/api/media", get(media_list))
        .route("/api/media/file", get(media))
        .route("/api/media/cache/clear", post(media_cache_clear))
        .route("/api/thumbnail", get(thumbnail))
        .route("/api/auth/account", put(auth_account))
        .route("/api/auth/reset", post(auth_reset))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth))
        .with_state(state);
    // ponytail: permissive CORS is fine pre-auth for LAN dev, but it lets any
    // webpage you visit read the API (files on this box) — restrict to known
    // origins when this faces the internet.
    public.merge(protected).layer(CorsLayer::permissive())
}

/// Bearer/session gate for every protected /api route.
/// Priority: env DIURN_TOKEN match, then session table; open before setup
/// when neither exists. <img>/<video> tags cannot send headers: allow ?token=.
async fn auth(
    State(state): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    // HTTP Basic for JSON calls; <img>/<video> tags cannot send headers, so
    // ?auth=<base64 user:pass> is accepted as a fallback.
    let header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .map(|s| s.trim().to_string());
    let query = req.uri().query().and_then(|q| {
        q.split('&')
            .find_map(|kv| kv.strip_prefix("auth="))
            // Flutter percent-encodes the query value ('=' -> %3D)
            .map(|v| {
                percent_encoding::percent_decode_str(v)
                    .decode_utf8_lossy()
                    .into_owned()
            })
    });
    let presented = header.or_else(|| query.map(|s| s.to_string()));
    let ok = {
        let conn = state.db.0.lock().unwrap();
        let mut verified = state.verified.lock().unwrap();
        auth::is_authorized(&conn, &mut verified, presented.as_deref())
    };
    if ok {
        next.run(req).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

/// GET /api/auth/status — public; tells the client which connect screen to show.
async fn auth_status(state: State<AppState>) -> Response {
    let conn = state.db.0.lock().unwrap();
    Json(auth::status(&conn)).into_response()
}

/// POST /api/auth/setup — first-run admin creation.
#[derive(Deserialize)]
struct SetupBody {
    password: String,
    #[serde(default)]
    timezone: String,
}

async fn auth_setup(state: State<AppState>, Json(body): Json<SetupBody>) -> Response {
    let mut conn = state.db.0.lock().unwrap();
    match auth::setup(&mut conn, &body.password, &body.timezone) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// POST /api/auth/verify — {username, password} -> 200 or 401.
#[derive(Deserialize)]
struct VerifyBody {
    #[serde(default = "default_username")]
    username: String,
    password: String,
}

fn default_username() -> String {
    "admin".into()
}

/// PUT /api/auth/account — change admin username/password.
#[derive(Deserialize)]
struct AccountBody {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

async fn auth_account(state: State<AppState>, Json(body): Json<AccountBody>) -> Response {
    let conn = state.db.0.lock().unwrap();
    match auth::update_account(&conn, body.username.as_deref(), body.password.as_deref()) {
        Ok(()) => {
            state.verified.lock().unwrap().clear();
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// POST /api/auth/reset — restore defaults (account admin/root included).
async fn auth_reset(state: State<AppState>) -> Response {
    let mut conn = state.db.0.lock().unwrap();
    match auth::reset_defaults(&mut conn) {
        Ok(()) => {
            state.verified.lock().unwrap().clear();
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

/// Bootstrap for clients: the allowed roots, so the UI knows where to start.
#[derive(serde::Serialize)]
struct Config {
    roots: Vec<String>,
}

async fn config(state: State<AppState>) -> Json<Config> {
    // Roots come from the active profile when the DB has one (shared with the
    // old app); env roots remain the fallback for profile-less setups.
    let roots = state
        .db
        .active_profile()
        .map(|p| {
            [p.daily_note_folder, p.media_folder]
                .into_iter()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .collect::<Vec<_>>()
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| state.roots.iter().cloned().collect());
    Json(Config { roots: roots.iter().map(|p| p.to_string_lossy().into_owned()).collect() })
}

#[derive(Deserialize)]
struct FsQuery {
    dir: Option<String>,
    filter: Option<String>,
    check: Option<String>,
    kind: Option<String>,
}

async fn fs(state: State<AppState>, Query(q): Query<FsQuery>) -> Response {
    if let Some(check) = q.check {
        return fs_check(&check, q.kind.as_deref());
    }
    fs_list(state, q.dir.as_deref(), q.filter.as_deref()).await
}

fn fs_check(path: &str, kind: Option<&str>) -> Response {
    let p = Path::new(path);
    if !p.exists() {
        return Json(json!({ "ok": false, "reason": "Path does not exist" })).into_response();
    }
    if kind == Some("media") && !p.is_dir() {
        return Json(json!({ "ok": false, "reason": "Not a directory" })).into_response();
    }
    Json(json!({ "ok": true })).into_response()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

async fn fs_list(state: State<AppState>, dir: Option<&str>, filter: Option<&str>) -> Response {
    let Some(dir) = dir else {
        return (StatusCode::BAD_REQUEST, "missing ?dir=").into_response();
    };
    let Ok(dir) = Path::new(dir).canonicalize() else {
        return (StatusCode::NOT_FOUND, "no such directory").into_response();
    };
    if !under_any_root(&state.roots, &dir) {
        return (StatusCode::FORBIDDEN, "path outside allowed roots").into_response();
    }
    let mut read_dir = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let mut entries: Vec<FsEntry> = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let path = entry.path();
        let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_dir && filter == Some("media") && !is_media_file(&name) {
            continue;
        }
        entries.push(FsEntry { name, path: path.to_string_lossy().into_owned(), is_dir });
    }
    entries.sort_by(|a, b| {
        (!a.is_dir)
            .cmp(&(!b.is_dir))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Json(json!({ "entries": entries })).into_response()
}

fn is_media_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .is_some_and(|e| MEDIA_EXTS.contains(&e.as_str()))
}

#[derive(Deserialize)]
struct MediaQuery {
    path: String,
}

/// GET /api/entries?year=&month=&date= — old JSON shape (array, fs-only ids negative).
#[derive(Deserialize)]
struct EntriesQuery {
    year: Option<String>,
    month: Option<String>,
    date: Option<String>,
}

async fn entries(state: State<AppState>, Query(q): Query<EntriesQuery>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return Json::<Vec<journal::Entry>>(vec![]).into_response();
    };
    let year_month = match (q.year.as_deref(), q.month.as_deref()) {
        (Some(y), Some(m)) => Some(format!("{y}-{:0>2}", m)),
        _ => None,
    };
    let conn = state.db.0.lock().unwrap();
    Json(journal::list_entries(&conn, &profile, year_month.as_deref(), q.date.as_deref()))
        .into_response()
}

/// GET /api/form — today's date + asked questions (no-AI form interface).
async fn form(state: State<AppState>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let conn = state.db.0.lock().unwrap();
    match journal::form(&conn, &profile, now_ms) {
        Some(info) => Json(info).into_response(),
        None => (StatusCode::BAD_REQUEST, "No questions configured").into_response(),
    }
}

/// POST /api/entries — form submission: {date, overwrite?, answers:{id:text}}.
#[derive(Deserialize)]
struct CreateBody {
    date: String,
    overwrite: Option<bool>,
    answers: std::collections::HashMap<String, String>,
}

async fn entries_create(state: State<AppState>, Json(body): Json<CreateBody>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let mut conn = state.db.0.lock().unwrap();
    match journal::create_entry(&mut conn, &profile, &body.date, body.overwrite.unwrap_or(false), &body.answers)
    {
        Ok(c) => Json(json!({
            "entry_id": c.entry_id,
            "file_path": c.file_path,
            "rendered": c.rendered,
            "extraction_warning": null,
        }))
        .into_response(),
        Err(journal::CreateError::Exists) => (
            StatusCode::CONFLICT,
            Json(json!({
                "exists": true,
                "error": "Entry already exists for this date"
            })),
        )
            .into_response(),
        Err(journal::CreateError::InvalidDate) => {
            (StatusCode::BAD_REQUEST, "Invalid date").into_response()
        }
        Err(journal::CreateError::Db(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
        }
    }
}

/// PUT /api/entries — {date, markdown}.
#[derive(Deserialize)]
struct UpdateBody {
    date: String,
    markdown: String,
}

async fn entries_update(state: State<AppState>, Json(body): Json<UpdateBody>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let conn = state.db.0.lock().unwrap();
    match journal::update_entry(&conn, &profile, &body.date, &body.markdown) {
        Ok((id, file_path)) => Json(json!({ "ok": true, "id": id, "file_path": file_path })).into_response(),
        Err(journal::UpdateError::InvalidDate) => (StatusCode::BAD_REQUEST, "Invalid date").into_response(),
        Err(journal::UpdateError::NotFound) => (StatusCode::NOT_FOUND, "Entry not found").into_response(),
        Err(journal::UpdateError::Db(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn entries_delete(state: State<AppState>, Query(q): Query<EntriesQuery>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let conn = state.db.0.lock().unwrap();
    match journal::delete_entry(&conn, &profile, q.date.as_deref().unwrap_or("")) {
        Ok(true) => Json(json!({ "ok": true })).into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, "Entry not found").into_response(),
        Err(journal::UpdateError::InvalidDate) => (StatusCode::BAD_REQUEST, "Invalid date").into_response(),
        Err(journal::UpdateError::NotFound) => (StatusCode::NOT_FOUND, "Entry not found").into_response(),
        Err(journal::UpdateError::Db(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

/// GET /api/settings — profile subset + questions + template content.
async fn settings(state: State<AppState>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let conn = state.db.0.lock().unwrap();
    match journal::get_settings(&conn, &profile) {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// PUT /api/settings — whitelisted profile fields + questions upsert.
#[derive(Deserialize)]
struct SettingsBody {
    profile: journal::ProfileIn,
    questions: Option<Vec<journal::QuestionIn>>,
    #[serde(default)]
    template_content: Option<String>,
}

async fn settings_put(state: State<AppState>, Json(body): Json<SettingsBody>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let mut conn = state.db.0.lock().unwrap();
    match journal::put_settings(
        &mut conn,
        profile.id,
        &body.profile,
        body.questions.as_ref(),
        body.template_content.as_deref(),
    ) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// GET /api/template-content?path= — live preview for the settings editor.
/// ponytail: reads any .md the server process can access; single-admin trust
/// model (same as /api/fs). Constrain to roots if that ever changes.
#[derive(Deserialize)]
struct TplQuery {
    path: String,
}

async fn template_content(_state: State<AppState>, Query(q): Query<TplQuery>) -> Response {
    let p = Path::new(&q.path);
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase());
    if ext.as_deref() != Some("md") {
        return (StatusCode::BAD_REQUEST, "Not a .md file").into_response();
    }
    match std::fs::read_to_string(p) {
        Ok(content) => Json(json!({ "content": content })).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Cannot read file").into_response(),
    }
}

/// GET /api/media?year=&month=&date= — {files:[{name,path,date,hasThumb,type}]}.
#[derive(Deserialize)]
struct MediaListQuery {
    year: Option<String>,
    month: Option<String>,
    date: Option<String>,
}

async fn media_list(state: State<AppState>, Query(q): Query<MediaListQuery>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return Json(json!({ "files": [] })).into_response();
    };
    let mut scanning = false;
    if !profile.media_folder.is_empty() {
        let folder = PathBuf::from(&profile.media_folder);
        if folder.is_dir() {
            let db = state.db.clone();
            let p = profile.clone();
            // Background scan — never block the response (a big library would
            // hang the tab for minutes). The flag is set synchronously, so
            // this response already reports scanning=true.
            scanning = media::request_scan(db, p, folder);
        }
    }
    let year_month = match (q.year.as_deref(), q.month.as_deref()) {
        (Some(y), Some(m)) => Some(format!("{y}-{:0>2}", m)),
        _ => None,
    };
    let conn = state.db.0.lock().unwrap();
    let files = media::list_files(&conn, profile.id, q.date.as_deref(), year_month.as_deref());
    let scanning = scanning || media::scan_in_progress();
    Json(json!({
        "files": files,
        "folder": profile.media_folder,
        "scanning": scanning,
    }))
    .into_response()
}

/// POST /api/media/cache/clear — drop cached media rows + generated thumbs.
async fn media_cache_clear(state: State<AppState>) -> Response {
    let Some(profile) = state.db.active_profile() else {
        return (StatusCode::BAD_REQUEST, "No active profile").into_response();
    };
    let cleared = {
        let conn = state.db.0.lock().unwrap();
        conn.execute(
            "DELETE FROM media_cache WHERE profile_id = ?1",
            rusqlite::params![profile.id],
        )
        .unwrap_or(0)
    };
    let thumbs = media::clear_thumbs(profile.id);
    Json(json!({ "cleared": cleared, "thumbs": thumbs })).into_response()
}

async fn media(state: State<AppState>, Query(q): Query<MediaQuery>, headers: HeaderMap) -> Response {
    let Ok(path) = Path::new(&q.path).canonicalize() else {
        return (StatusCode::NOT_FOUND, "no such file").into_response();
    };
    if !under_any_root(&state.roots, &path) || !path.is_file() {
        return (StatusCode::FORBIDDEN, "path outside allowed roots").into_response();
    }
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return (StatusCode::NOT_FOUND, "no such file").into_response();
    };
    let size = meta.len();
    let content_type = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let (status, start, end) = match parse_range(range.as_deref(), size) {
        Err(()) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Body::empty())
                .unwrap()
        }
        Ok(None) => (StatusCode::OK, 0, size - 1),
        Ok(Some((s, e))) => (StatusCode::PARTIAL_CONTENT, s, e),
    };

    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let mut file = file;
    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "seek failed").into_response();
    }
    let len = end - start + 1;
    let stream = ReaderStream::with_capacity(file.take(len), 64 * 1024);

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len);
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    builder.body(Body::from_stream(stream)).unwrap()
}

#[derive(Deserialize)]
struct ThumbQuery {
    path: String,
}

/// Server-side thumbnail: longest edge resized to ?size= (default 400),
/// JPEG-encoded, cached on disk keyed by path+mtime+size.
/// GET /api/thumbnail?path= — serve the scan-generated 400px webp thumbnail
/// (generated on demand if missing). One pipeline for images and videos;
/// the original is never re-decoded per request.
async fn thumbnail(state: State<AppState>, Query(q): Query<ThumbQuery>) -> Response {
    let Ok(path) = Path::new(&q.path).canonicalize() else {
        return (StatusCode::NOT_FOUND, "no such file").into_response();
    };
    if !under_any_root(&state.roots, &path) || !path.is_file() {
        return (StatusCode::FORBIDDEN, "path outside allowed roots").into_response();
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !is_media_file(&name) {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, "not a media file").into_response();
    }

    let pid = state.db.active_profile().map(|p| p.id).unwrap_or(0);
    let thumb = tokio::task::spawn_blocking(move || media::generate_thumb(pid, &path))
        .await
        .ok()
        .flatten();
    let Some(tp) = thumb else {
        return (StatusCode::UNPROCESSABLE_ENTITY, "cannot decode image").into_response();
    };
    match tokio::fs::read(&tp).await {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, "image/webp")
            .header(header::CACHE_CONTROL, "max-age=86400")
            .body(Body::from(bytes))
            .unwrap(),
        Err(_) => (StatusCode::NOT_FOUND, "no thumbnail").into_response(),
    }
}

/// Ok(None): no Range header -> serve whole file (200).
/// Ok(Some((start, end))): inclusive byte range -> 206.
/// Err(()): unsatisfiable range -> 416.
fn parse_range(header: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(spec) = header else { return Ok(None) };
    let spec = spec.trim();
    let Some(rest) = spec.strip_prefix("bytes=") else { return Err(()) };
    let rest = rest.trim();
    if let Some(suffix) = rest.strip_prefix('-') {
        // bytes=-N : last N bytes
        let n: u64 = suffix.trim().parse().map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        let start = size.saturating_sub(n);
        return Ok(Some((start, size - 1)));
    }
    let (s, e) = rest.split_once('-').ok_or(())?;
    let start: u64 = s.trim().parse().map_err(|_| ())?;
    let end: u64 = if e.trim().is_empty() {
        size - 1
    } else {
        e.trim().parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if start > end || start >= size {
        return Err(());
    }
    Ok(Some((start, end)))
}

/// Lexically-contained check + canonical containment. Rejects `..` components
/// outright; canonicalize() in callers resolves symlinks before this runs, and
/// build_router canonicalizes the roots to match.
fn under_any_root(roots: &[PathBuf], path: &Path) -> bool {
    if path.components().any(|c| c == Component::ParentDir) {
        return false;
    }
    roots.iter().any(|root| path.starts_with(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_none() {
        assert_eq!(parse_range(None, 100).unwrap(), None);
    }

    #[test]
    fn range_full_tail() {
        assert_eq!(parse_range(Some("bytes=-40"), 100).unwrap(), Some((60, 99)));
        // suffix larger than file: clamp to whole file
        assert_eq!(parse_range(Some("bytes=-500"), 100).unwrap(), Some((0, 99)));
    }

    #[test]
    fn range_explicit() {
        assert_eq!(parse_range(Some("bytes=0-"), 100).unwrap(), Some((0, 99)));
        assert_eq!(parse_range(Some("bytes=10-19"), 100).unwrap(), Some((10, 19)));
        // end beyond size clamps
        assert_eq!(parse_range(Some("bytes=90-999"), 100).unwrap(), Some((90, 99)));
    }

    #[test]
    fn range_unsatisfiable() {
        assert!(parse_range(Some("bytes=100-"), 100).is_err());
        assert!(parse_range(Some("bytes=50-10"), 100).is_err());
        assert!(parse_range(Some("bytes=-0"), 100).is_err());
        assert!(parse_range(Some("chunks=0-1"), 100).is_err());
    }

    #[test]
    fn traversal_rejected() {
        let roots = vec![PathBuf::from("/srv/media")];
        assert!(under_any_root(&roots, &Path::new("/srv/media/a/b.jpg")));
        assert!(!under_any_root(&roots, &Path::new("/srv/media/../etc/passwd")));
        assert!(!under_any_root(&roots, &Path::new("/etc/passwd")));
    }

    #[test]
    fn canonicalized_roots_admit_symlinked_paths() {
        // a media folder reached through a symlink (automounted NAS etc.)
        let real = std::env::temp_dir().join("diurn-canonical-test");
        std::fs::create_dir_all(&real).unwrap();
        let link = std::env::temp_dir().join("diurn-canonical-link");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&real, &link).unwrap();

        // build_router canonicalizes roots, so the real path under the link
        // is admitted even though the raw root string differs
        let resolved = link.canonicalize().unwrap();
        assert_eq!(resolved, real.canonicalize().unwrap());
        let roots = vec![link.clone()];
        let canonical_roots: Vec<PathBuf> = roots
            .iter()
            .map(|r| r.canonicalize().unwrap())
            .collect();
        assert!(under_any_root(&canonical_roots, &resolved));
        assert!(!under_any_root(&roots, &resolved)); // without canonicalization it 403s

        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir_all(&real);
    }
}

/// POST /api/auth/verify — {username, password} -> 200 or 401.
async fn auth_verify(state: State<AppState>, Json(body): Json<VerifyBody>) -> Response {
    let conn = state.db.0.lock().unwrap();
    if auth::verify_credentials(&conn, &body.username, &body.password) {
        Json(json!({ "ok": true })).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "Invalid username or password").into_response()
    }
}
