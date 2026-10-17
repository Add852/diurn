# diurn — Flutter + Rust

Cross-platform rewrite: Flutter native apps (iOS/Android/Windows/macOS/Linux)
talking to a self-hosted Rust server that owns the filesystem, journal storage,
and media streaming. Replaces the previous Next.js app; the JSON API mirrors
its route handlers.

## Layout

```
server/   Rust (axum): /api/config, /api/fs, /api/media (Range streaming)
app/      Flutter client: media grid, directory browser, image/video viewer
```

## Run the server

```sh
cd server
DIURN_ROOTS="$HOME:$HOME/pictures" cargo run        # ':'-separated allowed roots, default: $HOME
DIURN_TOKEN=sekrit cargo run                        # optional: require Bearer auth on all routes
```

Port: `DIURN_PORT` (default 8080). Only paths under a root are readable —
everything else is 403. Thumbnails cache under `DIURN_CACHE`
(default: system temp dir, `diurn-thumbs/`).

## Run the app

```sh
cd app
flutter pub get
# phone/emulator on the same LAN: use the server machine's IP, not localhost
flutter run --dart-define=DIURN_URL=http://192.168.1.20:8080
```

## API

| Endpoint | Meaning |
|---|---|
| `GET /api/config` | `{"roots": [...]}` — where the UI may browse |
| `GET /api/fs?dir=<abs>&filter=<media>` | `{"entries":[{name,path,isDir}]}` |
| `GET /api/fs?check=<abs>&kind=<media>` | `{"ok":bool,"reason"?}` |
| `GET /api/media?path=<abs>` | file stream; `Range` supported (206/416) |
| `GET /api/thumbnail?path=<abs>&size=` | JPEG thumb (longest edge, default 400), disk-cached |

Auth: when `DIURN_TOKEN` is set, every route needs `Authorization: Bearer
<token>`; media/thumbnail also accept `?token=` (img/video tags can't send
headers). Unset = no auth (LAN dev).

## Tests

```sh
cd server && cargo test          # 10 tests: range parsing, traversal, endpoints
cd app && flutter test           # JSON/model tests
```

## Not yet (deliberate)

- Auth/token middleware — add before exposing beyond localhost/LAN.
- HTTPS — terminate at a reverse proxy (e.g. Caddy) or add rustls.
- Journal storage endpoints — port from the Next.js handlers next.
- Thumbnails — server-side via the `image` crate when grids feel slow.
