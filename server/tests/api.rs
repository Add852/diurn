//! Integration tests: run against the real router, no network needed.
use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

fn app(root: &PathBuf) -> axum::Router {
    router_with_db(root, None)
}

fn router_with_db(root: &PathBuf, token: Option<String>) -> axum::Router {
    // keep the DB outside the served root so fs/media listings stay clean
    let dbfile = std::env::temp_dir()
        .join(format!("diurn-db-{}", root.file_name().unwrap().to_string_lossy()));
    let _ = std::fs::remove_file(&dbfile);
    let db = std::sync::Arc::new(diurn_server::db::Db::open(&dbfile).unwrap());
    diurn_server::build_router(vec![root.clone()], token, db)
}

/// Insert an active profile whose folders point at `root`.
fn seed_profile(root: &PathBuf) {
    let dbfile = std::env::temp_dir()
        .join(format!("diurn-db-{}", root.file_name().unwrap().to_string_lossy()));
    let conn = rusqlite::Connection::open(&dbfile).unwrap();
    conn.execute_batch(diurn_server::db::SCHEMA).unwrap();
    conn.execute(
        "INSERT INTO users (id, username, password_hash, salt) VALUES (1, 'test', 'x', 'y')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO profiles (id, user_id, name, is_active, is_default, daily_note_folder, media_enabled, media_folder)
         VALUES (1, 1, 'test', 1, 1, ?1, 1, ?2)",
        rusqlite::params![root.join("notes").to_string_lossy(), root.to_string_lossy()],
    )
    .unwrap();
}

fn app_with_token(root: &PathBuf, token: &str) -> axum::Router {
    router_with_db(root, Some(token.to_string()))
}

fn tmp_root(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("diurn-test-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[tokio::test]
async fn cors_preflight_allowed() {
    let root = tmp_root("cors");
    let res = app(&root)
        .oneshot(
            Request::get("/api/config")
                .header("origin", "http://localhost:5173")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers().contains_key("access-control-allow-origin"));
}

#[tokio::test]
async fn config_lists_roots() {
    let root = tmp_root("config");
    let res = app(&root)
        .oneshot(Request::get("/api/config").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["roots"][0], serde_json::json!(root.to_string_lossy()));
}

#[tokio::test]
async fn fs_list_filters_media() {
    let root = tmp_root("list");
    std::fs::write(root.join("a.jpg"), b"x").unwrap();
    std::fs::write(root.join("notes.txt"), b"x").unwrap();
    std::fs::create_dir_all(root.join("subdir")).unwrap();

    // unfiltered: dirs first, everything listed
    let res = app(&root)
        .oneshot(Request::get(format!("/api/fs?dir={}", root.display())).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let names: Vec<&str> = v["entries"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["subdir", "a.jpg", "notes.txt"]);
    assert_eq!(v["entries"][0]["isDir"], serde_json::json!(true));

    // media filter: only dirs + media files
    let res = app(&root)
        .oneshot(
            Request::get(format!("/api/fs?dir={}&filter=media", root.display()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let names: Vec<&str> = v["entries"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["subdir", "a.jpg"]);
}

#[tokio::test]
async fn fs_check_reports_missing_and_dirs() {
    let root = tmp_root("check");
    let app = app(&root);
    let res = app
        .clone()
        .oneshot(Request::get(format!("/api/fs?check={}", root.display())).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["ok"], serde_json::json!(true));

    let res = app
        .oneshot(Request::get("/api/fs?check=/definitely/not/here").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
    assert_eq!(v["ok"], serde_json::json!(false));
    assert!(v["reason"].as_str().unwrap().contains("exist"));
}

#[tokio::test]
async fn media_streams_with_range() {
    let root = tmp_root("media");
    let content: Vec<u8> = (0u8..=99).collect(); // bytes 0..=99
    std::fs::write(root.join("clip.bin"), &content).unwrap();
    let url = format!("/api/media/file?path={}", root.join("clip.bin").display());
    let app = app(&root);

    // full request -> 200
    let res = app
        .clone()
        .oneshot(Request::get(&url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()["accept-ranges"], "bytes");
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), &content);

    // range 10-19 -> 206 with those bytes
    let res = app
        .clone()
        .oneshot(
            Request::get(&url)
                .header("range", "bytes=10-19")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers()["content-range"], "bytes 10-19/100");
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), &content[10..20]);

    // unsatisfiable -> 416
    let res = app
        .oneshot(Request::get(&url).header("range", "bytes=100-").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(res.headers()["content-range"], "bytes */100");
}

#[tokio::test]
async fn media_rejects_outside_root() {
    let root = tmp_root("escape");
    let app = app(&root);
    let outside = std::env::temp_dir().join("diurn-outside-probe.txt");
    std::fs::write(&outside, b"secret").unwrap();
    let res = app
        .oneshot(
            Request::get(format!("/api/media/file?path={}", outside.display()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    std::fs::remove_file(&outside).ok();
}

#[tokio::test]
async fn thumbnail_resizes_and_caches() {
    let root = tmp_root("thumb");
    // 1200x600 red PNG -> 400x200 JPEG thumb
    let img = image::RgbaImage::from_pixel(1200, 600, image::Rgba([255u8, 0, 0, 255]));
    img.save(root.join("big.png")).unwrap();

    let res = app(&root)
        .oneshot(
            Request::get(format!("/api/thumbnail?path={}", root.join("big.png").display()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()["content-type"], "image/jpeg");
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let decoded = image::load_from_memory(&body).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (400, 200));

    // non-image -> 415
    std::fs::write(root.join("note.txt"), b"x").unwrap();
    let res = app(&root)
        .oneshot(
            Request::get(format!("/api/thumbnail?path={}", root.join("note.txt").display()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn auth_gate_and_media_token_query_fallback() {
    let root = tmp_root("auth");
    let content: Vec<u8> = (0u8..=9).collect();
    std::fs::write(root.join("clip.bin"), &content).unwrap();
    let media_url = format!("/api/media/file?path={}", root.join("clip.bin").display());
    let app = app_with_token(&root, "sekrit");

    // no credentials -> 401 on JSON route
    let res = app
        .clone()
        .oneshot(Request::get("/api/config").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // correct header -> 200
    let res = app
        .clone()
        .oneshot(
            Request::get("/api/config")
                .header("authorization", "Bearer sekrit")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // media via ?token= (img/video tags can't send headers)
    let res = app
        .clone()
        .oneshot(Request::get(&media_url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let res = app
        .clone()
        .oneshot(
            Request::get(format!("{media_url}&token=sekrit"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // wrong token rejected
    let res = app
        .oneshot(
            Request::get("/api/config?token=wrong")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn entries_merge_db_and_fs_only_notes() {
    let root = tmp_root("entries");
    let router = app(&root); // creates schema
    seed_profile(&root);
    let notes = root.join("notes");
    std::fs::create_dir_all(&notes).unwrap();

    // DB entry for 2026-01-10, fs-only note for 2026-01-12, junk files skipped
    let dbfile = std::env::temp_dir()
        .join(format!("diurn-db-{}", root.file_name().unwrap().to_string_lossy()));
    let conn = rusqlite::Connection::open(&dbfile).unwrap();
    conn.execute(
        "INSERT INTO entries (profile_id, date, rendered_markdown, file_path) VALUES (1, '2026-01-10', 'db note', NULL)",
        [],
    )
    .unwrap();
    std::fs::write(notes.join("2026-01-12.md"), "fs note").unwrap();
    std::fs::write(notes.join("random.md"), "no date in name").unwrap();
    std::fs::write(notes.join("2026-01-05.txt"), "not markdown").unwrap();

    let res = router.clone()
        .oneshot(Request::get("/api/entries").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let arr = v.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["date"], "2026-01-12"); // fs-only, newest first
    assert_eq!(arr[0]["_fs_only"], serde_json::json!(true));
    assert!(arr[0]["id"].as_i64().unwrap() < 0);
    assert_eq!(arr[1]["date"], "2026-01-10");
    assert_eq!(arr[1]["rendered_markdown"], "db note");

    // month filter
    let res = router.clone()
        .oneshot(
            Request::get("/api/entries?year=2026&month=02")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn media_scan_lists_and_thumbs() {
    let root = tmp_root("mediascan");
    let router = app(&root); // creates schema
    seed_profile(&root);
    let img = image::RgbaImage::from_pixel(800, 400, image::Rgba([10u8, 20, 30, 255]));
    image::DynamicImage::ImageRgb8(
        image::DynamicImage::ImageRgba8(img).to_rgb8(),
    )
    .save(root.join("pic.jpg"))
    .unwrap();
    // unrelated file + dot-dir must be ignored
    std::fs::write(root.join("song.txt"), b"x").unwrap();
    std::fs::create_dir_all(root.join(".hidden")).unwrap();

    let res = router.clone()
        .oneshot(Request::get("/api/media").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let files = v["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["name"], "pic.jpg");
    assert_eq!(files[0]["type"], "image");
    assert_eq!(files[0]["hasThumb"], serde_json::json!(true));
    assert!(files[0]["date"].as_str().is_some());

    // thumb exists in the shared ~/.diurn/thumbs layout; row cached ->
    // second request serves from cache without rescan churn
    let dbfile = std::env::temp_dir()
        .join(format!("diurn-db-{}", root.file_name().unwrap().to_string_lossy()));
    let conn = rusqlite::Connection::open(&dbfile).unwrap();
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM media_cache", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);

    // /api/media/file still streams the original
    let res = router.clone()
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/media/file?path={}",
                root.join("pic.jpg").display()
            ))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn form_create_update_delete_roundtrip() {
    let root = tmp_root("form");
    let router = app(&root);
    seed_profile(&root);
    let notes = root.join("notes");
    std::fs::create_dir_all(&notes).unwrap();

    // questions: Q1 asked, Q2 hidden
    let dbfile = std::env::temp_dir()
        .join(format!("diurn-db-{}", root.file_name().unwrap().to_string_lossy()));
    let conn = rusqlite::Connection::open(&dbfile).unwrap();
    for (ident, q, asked) in [
        ("Q1", "What happened?", 1),
        ("Q2", "Hidden question", 0),
    ] {
        conn.execute(
            "INSERT INTO profile_questions (profile_id, identifier, question, answer_prompt, asked, sort_order)
             VALUES (1, ?1, ?2, '', ?3, 0)",
            rusqlite::params![ident, q, asked],
        )
        .unwrap();
    }

    // form: date + asked questions only
    let res = router
        .clone()
        .oneshot(Request::get("/api/form").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["questions"].as_array().unwrap().len(), 1);
    assert_eq!(v["questions"][0]["identifier"], "Q1");
    assert!(v["date"].as_str().is_some());

    // create
    let res = router
        .clone()
        .oneshot(
            Request::post("/api/entries")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"date":"2026-10-17","answers":{"Q1":"wrote Rust code"}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let rendered = v["rendered"].as_str().unwrap();
    assert!(rendered.contains("wrote Rust code"));
    assert!(rendered.contains("dayOfWeek:"));
    // unanswered question renders empty, not literal tokens
    assert!(!rendered.contains("{Q2.answer}"));

    // file written atomically under notes folder
    let note = notes.join("2026-10-17.md");
    assert!(note.is_file());
    let on_disk = std::fs::read_to_string(&note).unwrap();
    assert_eq!(on_disk, rendered);

    // DB rows: entry + answer
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM entry_answers", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);

    // duplicate -> 409 with exists flag
    let res = router
        .clone()
        .oneshot(
            Request::post("/api/entries")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"date":"2026-10-17","answers":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["exists"], serde_json::json!(true));

    // PUT edit adopts and updates
    let res = router
        .clone()
        .oneshot(
            Request::put("/api/entries")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"date":"2026-10-17","markdown":"---\nweight: 1\n---\nedited"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(std::fs::read_to_string(&note).unwrap(), "---\nweight: 1\n---\nedited");

    // DELETE removes row + file
    let res = router
        .oneshot(
            Request::delete("/api/entries?date=2026-10-17")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(!note.exists());
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}
