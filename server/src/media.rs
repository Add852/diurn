//! Media list + folder scan — port of src/lib/media-cache.ts + /api/media.
//! Rows live in the shared media_cache table; thumbs in ~/.diurn/thumbs/<profileId>/.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

use crate::db::Profile;

// no svg: Flutter can't decode it via Image.network and the image crate can't
// thumbnail it — the prune deletes stale svg rows on the next scan
const MEDIA_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "mov", "mkv", "avi", "heic", "heif",
];
const VIDEO_EXTS: &[&str] = &["mp4", "webm", "mov", "mkv", "avi"];
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "heic", "heif", "webp"];

fn ext_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn is_video(path: &Path) -> bool {
    VIDEO_EXTS.contains(&ext_of(path).as_str())
}

pub fn is_image_ext(path: &Path) -> bool {
    IMAGE_EXTS.contains(&ext_of(path).as_str())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub name: String,
    pub path: String,
    pub date: Option<String>,
    pub has_thumb: bool,
    #[serde(rename = "type")]
    pub kind: String,
}

/// GET /api/media rows, old ordering: newest day first, oldest capture first
/// within a day, path as tiebreaker.
pub fn list_files(
    conn: &Connection,
    profile_id: i64,
    date: Option<&str>,
    year_month: Option<&str>,
) -> Vec<MediaFile> {
    let mut sql = String::from(
        "SELECT path, date, thumb, type FROM media_cache WHERE profile_id = ?1",
    );
    if date.is_some() {
        sql.push_str(" AND date = ?2");
    }
    if year_month.is_some() {
        sql.push_str(&format!(
            " AND date LIKE ?{}",
            if date.is_some() { "3" } else { "2" }
        ));
    }
    sql.push_str(" ORDER BY date DESC, captured_at ASC, path ASC");

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<(String, Option<String>, Option<String>, String)> {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    };
    let rows = match (date, year_month) {
        (Some(d), Some(ym)) => stmt.query_map(rusqlite::params![profile_id, d, format!("{ym}%")], map_row),
        (Some(d), None) => stmt.query_map(rusqlite::params![profile_id, d], map_row),
        (None, Some(ym)) => stmt.query_map(rusqlite::params![profile_id, format!("{ym}%")], map_row),
        (None, None) => stmt.query_map(rusqlite::params![profile_id], map_row),
    };
    let mut out = Vec::new();
    if let Ok(rows) = rows {
        for r in rows.flatten() {
            let (path, date, thumb, kind) = r;
            let p = Path::new(&path);
            out.push(MediaFile {
                name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path,
                date,
                has_thumb: thumb.is_some(),
                kind,
            });
        }
    }
    out
}

/// Incremental scan: walk folder, re-resolve only changed paths, prune gone
/// ones, generate thumbs for new rows. ponytail: full walk per /api/media
/// request; add fs.watch + background scan when libraries get huge.
/// One scan at a time, process-wide. Concurrent scans (every /api/media
/// request kicks one) would stack up and starve the CPU.
static SCAN_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// True while a background scan walks the folder — surfaced via /api/media
/// so clients can show a scanning indicator.
pub fn scan_in_progress() -> bool {
    use std::sync::atomic::Ordering;
    SCAN_RUNNING.load(Ordering::SeqCst)
}

/// Finished scans younger than this skip the re-walk (network mounts: every
/// /api/media request would otherwise stat the whole tree again).
const SCAN_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(5);
static LAST_SCAN_DONE: std::sync::Mutex<Option<std::time::Instant>> =
    std::sync::Mutex::new(None);

/// Fire-and-forget scan kick. Sets the scanning flag SYNCHRONOUSLY so the
/// response that triggers the scan already reports it — otherwise the first
/// request after a folder change says scanning=false and clients show an
/// empty list with no loading state. Returns true (always: kicked or a scan
/// is already in flight).
pub fn request_scan(
    db: std::sync::Arc<crate::db::Db>,
    profile: Profile,
    folder: std::path::PathBuf,
) -> bool {
    use std::sync::atomic::Ordering;
    if SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        return true; // genuinely in flight
    }
    {
        // cooldown decided SYNCHRONOUSLY: skipping here means the flag is
        // already false again — reporting true would stick the client's
        // loading bar forever
        let last = LAST_SCAN_DONE.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < SCAN_COOLDOWN && cache_has_rows(&db, profile.id) {
                drop(last);
                SCAN_RUNNING.store(false, Ordering::SeqCst);
                return false;
            }
        }
    }
    let _ = tokio::task::spawn_blocking(move || {
        let _guard = ScanGuard;
        let n = scan_inner(&db, &profile, &folder);
        *LAST_SCAN_DONE.lock().unwrap() = Some(std::time::Instant::now());
        n
    });
    true
}

fn cache_has_rows(db: &crate::db::Db, profile_id: i64) -> bool {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT 1 FROM media_cache WHERE profile_id = ?1 LIMIT 1",
        rusqlite::params![profile_id],
        |_| Ok(()),
    )
    .is_ok()
}

struct ScanGuard;
impl Drop for ScanGuard {
    fn drop(&mut self) {
        std::sync::atomic::AtomicBool::store(
            &SCAN_RUNNING,
            false,
            std::sync::atomic::Ordering::SeqCst,
        );
    }
}

fn scan_inner(db: &crate::db::Db, profile: &Profile, folder: &Path) -> usize {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    // Short lock: read the cache, then release — the walk + EXIF + thumbnail
    // work below must not block journal/entry requests behind the mutex.
    let cached: HashMap<String, (i64, Option<String>)> = {
        let conn = db.0.lock().unwrap();
        let mut map = HashMap::new();
        if let Ok(mut stmt) = conn
            .prepare("SELECT path, mtime, thumb FROM media_cache WHERE profile_id = ?1")
        {
            if let Ok(rows) = stmt.query_map(rusqlite::params![profile.id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            }) {
                for r in rows.flatten() {
                    map.insert(r.0, (r.1, r.2));
                }
            }
        }
        map
    };

    // Stream: workers process files AS the walk discovers them (network
    // mounts: first rows land in the cache within seconds, not after the
    // whole walk). Each worker commits its own short batches.
    let todo: std::sync::Mutex<std::collections::VecDeque<(std::path::PathBuf, i64)>> =
        std::sync::Mutex::new(std::collections::VecDeque::new());
    let seen: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    let walk_done = AtomicBool::new(false);
    let written = AtomicUsize::new(0);

    std::thread::scope(|s| {
        let workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8);
        for _ in 0..workers {
            s.spawn(|| {
                let mut batch: Vec<(
                    String,
                    Option<String>,
                    i64,
                    i64,
                    Option<String>,
                    String,
                )> = Vec::new();
                loop {
                    // pop_front claims each item exactly once — polling never
                    // burns queue slots
                    let item = todo.lock().unwrap().pop_front();
                    match item {
                        Some((p, mtime_ms)) => {
                            let path_str = p.to_string_lossy().into_owned();
                            let ext = ext_of(&p);
                            let kind = if VIDEO_EXTS.contains(&ext.as_str()) {
                                "video"
                            } else {
                                "image"
                            };
                            let (date, captured_at) = resolve_date(&p, mtime_ms);
                            let thumb = generate_thumb(profile.id, &p)
                                .map(|t| t.to_string_lossy().into_owned());
                            batch.push((
                                path_str,
                                date,
                                captured_at,
                                mtime_ms,
                                thumb,
                                kind.to_string(),
                            ));
                            if batch.len() >= 25 {
                                written.fetch_add(
                                    flush_batch(db, profile.id, &mut batch),
                                    Ordering::Relaxed,
                                );
                            }
                        }
                        None => {
                            if walk_done.load(Ordering::SeqCst) {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        }
                    }
                }
                if !batch.is_empty() {
                    written.fetch_add(flush_batch(db, profile.id, &mut batch), Ordering::Relaxed);
                }
            });
        }
        // the scan thread itself walks and feeds the queue
        walk(folder, &mut |p, mtime_ms| {
            let path_str = p.to_string_lossy().into_owned();
            seen.lock().unwrap().push(path_str.clone());
            let ext = ext_of(p);
            if !MEDIA_EXTS.contains(&ext.as_str()) {
                return;
            }
            if let Some((_, old_mtime, old_thumb)) =
                cached.get(&path_str).map(|(m, t)| ((), *m, t))
            {
                // unchanged AND already thumbnailed → skip. Rows with no thumb
                // (e.g. videos from before ffmpeg support) get reprocessed.
                if old_mtime == mtime_ms && old_thumb.is_some() {
                    return;
                }
            }
            todo.lock().unwrap().push_back((p.to_path_buf(), mtime_ms));
        });
        walk_done.store(true, Ordering::SeqCst);
    });

    // prune: files gone from the walk, or no longer classified as media
    // (stale rows from older binaries, e.g. svg listings)
    let seen_set: std::collections::HashSet<String> =
        seen.into_inner().unwrap().into_iter().collect();
    let written = written.load(Ordering::Relaxed);
    let mut conn = db.0.lock().unwrap();
    let Ok(tx) = conn.transaction() else {
        return written;
    };
    let stale: Vec<String> = cached
        .keys()
        .filter(|p| {
            !seen_set.contains(*p) || !MEDIA_EXTS.contains(&ext_of(Path::new(p)).as_str())
        })
        .cloned()
        .collect();
    for path in &stale {
        let _ = tx.execute(
            "DELETE FROM media_cache WHERE path = ?1 AND profile_id = ?2",
            rusqlite::params![path, profile.id],
        );
    }
    let _ = tx.commit();
    written
}

/// Commit a worker's batch in one short transaction; clears the batch.
fn flush_batch(
    db: &crate::db::Db,
    profile_id: i64,
    batch: &mut Vec<(
        String,
        Option<String>,
        i64,
        i64,
        Option<String>,
        String,
    )>,
) -> usize {
    let mut conn = db.0.lock().unwrap();
    let Ok(tx) = conn.transaction() else { return 0 };
    for (path, date, captured_at, mtime, thumb, kind) in batch.iter() {
        if let Err(e) = tx.execute(
            "INSERT INTO media_cache (path, profile_id, date, captured_at, type, mtime, thumb, scanned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
             ON CONFLICT(path, profile_id) DO UPDATE SET date=?3, captured_at=?4, type=?5, mtime=?6, thumb=?7, scanned_at=datetime('now')",
            rusqlite::params![path, profile_id, date, captured_at, kind, mtime, thumb],
            ) {
                eprintln!("[flush err] {e}");
            }
    }
    let _ = tx.commit();
    let n = batch.len();
    batch.clear();
    n
}

fn walk(dir: &Path, f: &mut impl FnMut(&Path, i64)) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut dirs = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        match e.file_type() {
            Ok(t) if t.is_dir() => {
                if !name.starts_with('.') {
                    dirs.push(p);
                }
            }
            Ok(t) if t.is_file() => {
                let mtime_ms = e
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                f(&p, mtime_ms);
            }
            _ => {}
        }
    }
    for d in dirs {
        walk(&d, f);
    }
}

/// EXIF DateTimeOriginal -> (date, epoch ms); fallback: FS mtime local date.
/// ponytail: profile timezone/day_offset ignored for now (default 0/UTC-ish);
/// EXIF naive datetime treated as-is — add jiff + tz conversion when needed.
fn resolve_date(path: &Path, mtime_ms: i64) -> (Option<String>, i64) {
    use chrono::TimeZone;
    if let Some((date, ms)) = exif_date(path) {
        return (Some(date), ms);
    }
    let date = chrono::Local
        .timestamp_millis_opt(mtime_ms)
        .single()
        .map(|d| d.format("%Y-%m-%d").to_string());
    (date, mtime_ms)
}

fn exif_date(path: &Path) -> Option<(String, i64)> {
    if !is_image_ext(path) {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let reader = exif::Reader::new()
        .read_from_container(&mut std::io::BufReader::new(file))
        .ok()?;
    let field = reader
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)?;
    let raw = match &field.value {
        exif::Value::Ascii(vecs) => vecs
            .first()
            .map(|b| String::from_utf8_lossy(b).into_owned())?,
        _ => return None,
    };
    // "2024:01:31 18:22:33" -> "2024-01-31" + naive ms (stable within-day order)
    let (d, t) = raw.trim().split_once(' ')?;
    let date = d.replace(':', "-");
    let parts: Vec<u64> = t.split(':').filter_map(|x| x.trim().parse().ok()).collect();
    if parts.len() < 3 {
        return Some((date, 0));
    }
    let midnight = chrono::NaiveDate::from_ymd_opt(
        date.get(0..4)?.parse().ok()?,
        date.get(5..7)?.parse().ok()?,
        date.get(8..10)?.parse().ok()?,
    )?
    .and_hms_opt(0, 0, 0)?
    .and_utc()
    .timestamp_millis();
    Some((
        date,
        midnight + (parts[0] * 3_600_000 + parts[1] * 60_000 + parts[2] * 1000) as i64,
    ))
}

/// Old thumb layout: ~/.diurn/thumbs/<profileId>/<sha1(path)[..24]>.webp —
/// shared with the old app's cache.
pub fn thumb_path(profile_id: i64, file: &Path) -> PathBuf {
    use sha1::{Digest, Sha1};
    let mut h = Sha1::new();
    h.update(file.to_string_lossy().as_bytes());
    let digest = format!("{:x}", h.finalize());
    dirs_thumbs()
        .join(profile_id.to_string())
        .join(format!("{}.webp", &digest[..24]))
}

fn dirs_thumbs() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".diurn").join("thumbs"))
        .unwrap_or_else(|_| std::env::temp_dir().join("diurn-thumbs"))
}

/// 400px WebP, EXIF-orientation applied, no enlargement, atomic write.
/// ponytail: image crate only does lossless WebP encode — larger files than
/// sharp's lossy; swap in libwebp-sys when size matters.
pub fn generate_thumb(profile_id: i64, file: &Path) -> Option<PathBuf> {
    if is_video(file) {
        return generate_video_thumb(profile_id, file);
    }
    if !is_image_ext(file) {
        return None;
    }
    let target = thumb_path(profile_id, file);
    if target.exists() {
        return Some(target);
    }
    let img = image::open(file).ok()?;
    let oriented = apply_exif_orientation(file, img);
    let thumb = if oriented.width() > 400 {
        oriented.thumbnail(400, 400)
    } else {
        oriented
    };
    let tmp = target.with_extension("webp.tmp");
    std::fs::create_dir_all(target.parent()?).ok()?;
    image::DynamicImage::ImageRgb8(thumb.to_rgb8())
        .save_with_format(&tmp, image::ImageFormat::WebP)
        .ok()?;
    std::fs::rename(&tmp, &target).ok()?;
    Some(target)
}

/// ffmpeg first-frame thumbnail for videos. Missing/broken ffmpeg → None
/// (no thumb, the app shows its placeholder — same as before).
fn generate_video_thumb(profile_id: i64, file: &Path) -> Option<PathBuf> {
    let target = thumb_path(profile_id, file);
    if target.exists() {
        return Some(target);
    }
    std::fs::create_dir_all(target.parent()?).ok()?;
    let frame = target.with_extension("frame.png");
    let mut child = std::process::Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-i"])
        .arg(file)
        .args(["-frames:v", "1", "-vf", "scale=400:-2"])
        .arg(&frame)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    // bounded wait: a stalled network mount must not hang the scan thread
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => {
                let _ = std::fs::remove_file(&frame);
                return None;
            }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&frame);
                return None;
            }
        }
    }
    let img = image::open(&frame).ok()?;
    let _ = std::fs::remove_file(&frame);
    image::DynamicImage::ImageRgb8(img.to_rgb8())
        .save_with_format(&target, image::ImageFormat::WebP)
        .ok()?;
    Some(target)
}

fn apply_exif_orientation(file: &Path, img: image::DynamicImage) -> image::DynamicImage {
    let orientation = std::fs::File::open(file).ok().and_then(|f| {
        exif::Reader::new()
            .read_from_container(&mut std::io::BufReader::new(f))
            .ok()?
            .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
    });
    match orientation {
        Some(2) => img.fliph(),
        Some(3) => img.rotate180(),
        Some(4) => img.flipv(),
        Some(5) => img.fliph().rotate270(),
        Some(6) => img.rotate90(),
        Some(7) => img.fliph().rotate90(),
        Some(8) => img.rotate270(),
        _ => img,
    }
}

#[cfg(test)]
mod video_thumb_tests {
    use super::*;

    #[test]
    fn video_thumb_via_ffmpeg() {
        // skip on machines without ffmpeg (CI/containers without the dep)
        if std::process::Command::new("ffmpeg")
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| !s.success())
            .unwrap_or(true)
        {
            return;
        }
        let dir = std::env::temp_dir().join("diurn-video-thumb-test");
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("test.mp4");
        let _ = std::fs::remove_file(&video);
        assert!(std::process::Command::new("ffmpeg")
            .args(["-y", "-loglevel", "error", "-f", "lavfi",
                   "-i", "testsrc=duration=1:size=320x240:rate=10"])
            .arg(&video)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
        let thumb = generate_thumb(999, &video);
        assert!(thumb.is_some(), "video thumb should generate when ffmpeg exists");
        assert!(thumb.unwrap().exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    fn scan_streams_rows() {
        let dir = std::env::temp_dir().join("diurn-scan-stream-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        image::DynamicImage::ImageRgb8(image::ImageBuffer::from_pixel(
            80,
            40,
            image::Rgb([1, 2, 3]),
        ))
        .save(dir.join("a.jpg"))
        .unwrap();

        let db = crate::db::Db::open(&dir.join("db.sqlite")).unwrap();
        let profile = Profile {
            id: 1,
            name: "t".into(),
            daily_note_folder: String::new(),
            template_note_path: String::new(),
            media_folder: dir.to_string_lossy().into_owned(),
            timezone: "UTC".into(),
            day_offset_hours: 0,
            theme_mode: "system".into(),
            accent_color: "#22c55e".into(),
        };
        let n = scan_inner(&db, &profile, &dir);
        assert_eq!(n, 1, "scan should index the jpg");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
