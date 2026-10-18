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
```

Port: `DIURN_PORT` (default 12321). Only paths under a root are readable —
everything else is 403. DB at `~/.diurn/data.db` (override: `DIURN_DB`).
Thumbnails cache under `DIURN_CACHE` (default: system temp dir, `diurn-thumbs/`).

## Run the app

```sh
cd app
flutter pub get
# phone/emulator on the same LAN: use the server machine's IP, not localhost
flutter run --dart-define=DIURN_URL=http://192.168.1.20:12321
```

## API

| Endpoint | Meaning |
|---|---|
| `GET /api/config` | `{"roots": [...]}` — active profile's note/media folders |
| `GET /api/fs?dir=<abs>&filter=<media>` | `{"entries":[{name,path,isDir}]}` |
| `GET /api/fs?check=<abs>&kind=<media>` | `{"ok":bool,"reason"?}` |
| `GET /api/form` | today's date + asked questions (no-AI form) |
| `GET /api/entries?year=&month=&date=` | journal days; DB rows merged with fs-only `{date}.md` |
| `POST /api/entries` | form answers → template → atomic `{date}.md` + rows (409 if exists) |
| `PUT /api/entries` | `{date, markdown}` edit (file + row, adopts fs-only) |
| `DELETE /api/entries?date=` | remove row + file (only under notes folder) |
| `GET /api/media?year=&month=&date=` | `{files:[…]}`; triggers incremental EXIF scan |
| `GET /api/media/file?path=<abs>` | file stream; `Range` supported (206/416) |
| `GET /api/thumbnail?path=<abs>&size=` | JPEG thumb (longest edge, default 400), disk-cached |

Auth: single admin (HTTP Basic). First run is open — create the admin via
`POST /api/auth/setup {password, timezone}` (or the app's connect screen).
After that every route needs `Authorization: Basic <base64 user:pass>`;
media/thumbnail also accept `?auth=` (img/video tags can't send headers).
`POST /api/auth/reset` restores all defaults (admin/root).

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
