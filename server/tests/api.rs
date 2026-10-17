//! Integration tests: run against the real router, no network needed.
use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

fn app(root: &PathBuf) -> axum::Router {
    diurn_server::build_router(vec![root.clone()], None)
}

fn app_with_token(root: &PathBuf, token: &str) -> axum::Router {
    diurn_server::build_router(vec![root.clone()], Some(token.to_string()))
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
    let media_url = format!("/api/media?path={}", root.join("clip.bin").display());
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
