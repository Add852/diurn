# Diurn

Self-hosted daily journaling PWA. An AI chat companion asks about your day, turns your answers into markdown notes saved to disk, and can pull in your Google Tasks, Google Calendar, local media, and Obsidian vault for context.

- Single user, password auth (iron-session cookie)
- SQLite storage (no external DB server)
- Local LLM — your journal never leaves your device
- PWA: installable, works offline after first visit

## Requirements

- Node.js 18.17+ (any current LTS)
- npm
- An OpenAI-compatible LLM endpoint (Ollama, LM Studio, vLLM, …) — configured **after** install in Settings
- A C/C++ toolchain only if `better-sqlite3` has no prebuilt binary for your platform (it usually does)

## Install & run

```bash
git clone https://github.com/Add852/diurn.git
cd diurn
npm install
npm run serve
```

Open <http://localhost:11123> — first visit redirects to the setup screen.

`npm run serve` builds if needed, then starts the server in the background (survives terminal close, logs to `~/.diurn/server.log`).

### Commands

| Command | What it does |
|---|---|
| `npm run serve` | build if stale, start in background |
| `npm run serve:stop` / `serve:restart` | stop / stop + start |
| `npm run serve:status` | running / port / pid |
| `npm run serve:logs` | tail the server log |
| `npm run serve:enable` | set-and-forget: systemd user service — starts on boot, auto-restarts on crash |
| `npm run serve:disable` | undo enable |

`serve:enable` requires systemd (any mainstream Linux distro). Without it, plain `npm run serve` still runs in the background; re-run it after a reboot.

`npm run dev` is for development only (hot reload, no service worker).

### Configuration file

Persistent server settings live in `~/.diurn/serve.conf` (create it yourself; shell syntax):

```bash
PORT=9000        # default 11123
HOST=127.0.0.1   # bind address; default binds all interfaces
```

Environment variables (`PORT=... npm run serve`) win over the file. After changing the port, re-run `npm run serve:enable` to regenerate the unit.

## First-run setup

1. Choose a password (min. 4 chars) and your timezone. Username is `admin`.
2. Setup creates a **Default** profile with three starter questions ("What happened today?", "What are your thoughts and feels?", "One small adjustment for next time?").
3. The SQLite database is created automatically at `~/.diurn/data.db` — schema auto-migrates, no manual steps.
4. Open **Settings → AI** and point it at your LLM server. Nothing is configured by default; with Ollama the hint values are endpoint `http://localhost:11434/v1` and model `llama3.2:3b` (pull it first with `ollama pull llama3.2:3b`).

Everything else — media folder, Google integrations, Obsidian — is also configured in Settings.

## Integrations

### Media

Point **Settings → Media** at a local folder (e.g. your phone's camera sync). Photos/videos are scanned, EXIF dates extracted, and shown in the journal viewer with range-streamed playback. No uploads — served straight from disk.

### Google Tasks & Calendar

Provide a Google OAuth client ID/secret in **Settings**. The redirect URI is hardcoded to `http://localhost:11123/api/auth/google/callback` — register that exact URI in the [Google Console](https://console.cloud.google.com/apis/credentials). If you change the port, update the registration. Google only allows public TLDs, so from another device on your LAN you must complete the OAuth callback on the host (documented in the Settings UI).

### Obsidian

Set the vault folder in **Settings → Obsidian** to include notes from it as chat context, and write generated entries into the vault.

## Data & backups

| What | Where |
|---|---|
| Database | `~/.diurn/data.db` (+ `-wal`/`-shm`) |
| Session secret | `~/.diurn/session-secret` (auto-generated, mode 0600) |
| Server config / log | `~/.diurn/serve.conf` / `~/.diurn/server.log` |
| Journal entries | markdown files in each profile's configured folder |

Back up `~/.diurn/` and the journal/media folders.

## Production notes

- The session cookie is marked `secure` in production builds — serve over HTTPS (or keep it on localhost).
- `better-sqlite3` is externalized from the server bundle, so keep `node_modules` installed on the host; there's no Docker image.
- LLM output is capped at 1024 tokens per request (hardcoded in `src/lib/ai.ts`). The context window is your LLM server's setting; with Ollama raise it at server start, e.g. `OLLAMA_CONTEXT_LENGTH=16384 ollama serve` (default 8192 uses more RAM/VRAM when raised).

## Verify

```bash
npm run typecheck
npm test    # 20 node:test cases, zero test dependencies
```

## Troubleshooting

- **`better-sqlite3` fails to build** — install build tools (`python3`, `make`, `g++`; on Windows: Visual Studio Build Tools) and reinstall.
- **Chat says AI is not configured / can't reach the model** — set endpoint + model in **Settings → AI**; use the "Test connection" button there.
- **Port already in use** — set `PORT` in `~/.diurn/serve.conf` or the environment.
- **Forgot the password** — self-hosted single-user: stop the server, `rm ~/.diurn/data.db`, restart — the setup page reappears. Markdown entries are kept separately.

See `PROJECT_STATE.md` for architecture notes and the changelog.
