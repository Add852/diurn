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

use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tokio_util::io::ReaderStream;

const MEDIA_EXTS: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif",
];

#[derive(Clone)]
pub struct AppState {
    roots: Arc<Vec<PathBuf>>,
}

pub fn build_router(roots: Vec<PathBuf>) -> Router {
    Router::new()
        .route("/api/config", get(config))
        .route("/api/fs", get(fs))
        .route("/api/media", get(media))
        .with_state(AppState { roots: Arc::new(roots) })
}

/// Bootstrap for clients: the allowed roots, so the UI knows where to start.
#[derive(serde::Serialize)]
struct Config {
    roots: Vec<String>,
}

async fn config(state: State<AppState>) -> Json<Config> {
    Json(Config {
        roots: state
            .roots
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    })
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
/// outright; canonicalize() in callers resolves symlinks before this runs.
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
}
