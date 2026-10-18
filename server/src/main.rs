use diurn_server::build_router;

fn main() {
    let roots: Vec<std::path::PathBuf> = match std::env::var("DIURN_ROOTS") {
        Ok(v) => std::env::split_paths(&v).collect(),
        Err(_) => vec![dirs_home()],
    };
    for r in &roots {
        println!("allowed root: {}", r.display());
    }
    let db_path = std::env::var("DIURN_DB")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| dirs_home().join(".diurn").join("data.db"));
    let db = std::sync::Arc::new(
        diurn_server::db::Db::open(&db_path).expect("open sqlite db"),
    );
    println!("db: {}", db_path.display());
    let port: u16 = std::env::var("DIURN_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(12321);

    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async move {
        let app = build_router(roots, db);
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
            .await
            .expect("bind 0.0.0.0");
        println!("listening on http://0.0.0.0:{port}");
        axum::serve(listener, app).await.expect("serve");
    });
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}
