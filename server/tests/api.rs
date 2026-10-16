//! Integration tests: run against the real router, no network needed.
use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

fn app(root: &PathBuf) -> axum::Router {
    diurn_server::build_router(vec![root.clone()])
}

fn tmp_root(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("diurn-test-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
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
    let url = format!("/api/media?path={}", root.join("clip.bin").display());
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
            Request::get(format!("/api/media?path={}", outside.display()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    std::fs::remove_file(&outside).ok();
}
