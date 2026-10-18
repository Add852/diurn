# diurn — Flutter + Rust

Cross-platform rewrite: Flutter native apps (iOS/Android/Windows/macOS/Linux/web)
talking to a self-hosted Rust server that owns the filesystem, journal storage,
and media streaming. Replaces the previous Next.js app (preserved on the
[`legacy`](../../tree/legacy) branch); the JSON API mirrors its route handlers,
and both apps share the same `~/.diurn/data.db`.

## Features

- **Today** — no-AI entry form: pick any day (defaults to the server's
  offset-adjusted "today"), see that day's media, answers render through the
  note template into `{date}.md`.
- **Journal** — compact grid of entry cards with the day's photo as background,
  frontmatter metadata as capsules, immediate edits, entry preview with the
  day's full media strip and lightbox.
- **Media** — day-grouped library with EXIF-based dating, incremental background
  scan, disk-cached thumbnails, Range-streamed video.
- **Settings** — folders (server-side pickers), timezone, day offset, template
  editor with a built-in guide, reorderable questions, appearance (system/dark/
  light + accent color), admin account, import/export.
- **Auth** — single admin over HTTP Basic; first run is a setup screen.

## Layout

```
server/   Rust (axum): journal, media, settings, auth, fs
app/      Flutter client: form, journal, media, settings
```

## Run the server

```sh
cd server
cargo run                    # default port 12321, DB at ~/.diurn/data.db
```

| Env | Default | Meaning |
|---|---|---|
| `DIURN_PORT` | `12321` | listen port |
| `DIURN_DB` | `~/.diurn/data.db` | SQLite path (shared with the old app) |
| `DIURN_ROOTS` | `$HOME` | `:`-separated allowed roots — anything outside is 403 |
| `DIURN_CACHE` | system temp | thumbnail cache dir |

## Run the app

```sh
cd app
flutter pub get
# phone/emulator on the same LAN: use the server machine's IP, not localhost
flutter run --dart-define=DIURN_URL=http://192.168.1.20:12321
```

The connect screen handles first-run setup (create the admin) and login; the
address and credentials persist on the device.

## API

| Endpoint | Meaning |
|---|---|
| `GET /api/config` | `{"roots":[...]}` — active profile's note/media folders |
| `GET /api/auth/status` | `{needs_setup, mode, username}` |
| `POST /api/auth/setup` | `{password, timezone}` — only while no admin exists |
| `POST /api/auth/verify` | `{username, password}` credential check |
| `PUT /api/auth/account` | change admin username and/or password |
| `POST /api/auth/reset` | restore defaults (admin/root, settings wiped, entries kept) |
| `GET /api/form` | today's date + asked questions |
| `GET /api/entries?year=&month=&date=` | journal days; DB rows merged with fs-only `{date}.md` |
| `POST /api/entries` | form answers → template → atomic `{date}.md` + rows (409 if exists) |
| `PUT /api/entries` | `{date, markdown}` edit (file + row, adopts fs-only) |
| `DELETE /api/entries?date=` | remove row + file (only under the notes folder) |
| `GET /api/settings` | profile, questions, template content, admin username |
| `PUT /api/settings` | save profile + questions (upsert by id) + template content |
| `GET /api/template-content?path=` | read a `.md` file for the template editor |
| `GET /api/media` | `{files:[…], folder}` cached list; kicks the incremental scan |
| `GET /api/media/file?path=<abs>` | file stream; `Range` supported (206/416) |
| `GET /api/thumbnail?path=<abs>&size=` | JPEG thumb (longest edge, default 400) |
| `GET /api/fs?dir=…&filter=…` / `?check=…` | server-side browser used by the path pickers |

Auth: single admin over HTTP Basic. First run is open — create the admin via
`POST /api/auth/setup` (or the app's connect screen). After that every route
needs `Authorization: Basic <base64 user:pass>`; media/thumbnail also accept
`?auth=` (img/video tags can't send headers).

## Tests

```sh
cd server && cargo test        # 23 tests: template, media, auth, endpoints
cd app && flutter test         # JSON/model tests
```

## Not yet (deliberate)

- AI answer-refinement pass and the old chat-style entry flow.
- Integrations (Google Tasks/Calendar, Obsidian).
- HTTPS — terminate at a reverse proxy (e.g. Caddy) or add rustls.
- Packaging polish: app icons, signed releases, store builds.
