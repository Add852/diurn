# Diurn

Self-hosted daily journaling PWA. An AI chat companion asks about your day, turns your answers into markdown notes saved to disk, and can pull in your Google Tasks, Google Calendar, local media, and Obsidian vault for context.

- Single user, password auth (iron-session cookie)
- SQLite storage (no external DB server)
- Local LLM only — your journal never leaves your device
- PWA: installable, works offline after first visit

## Requirements

- Node.js 18.17+ (any current LTS)
- npm
- [Ollama](https://ollama.com/) (or any OpenAI-compatible LLM endpoint) for the chat/journaling features
- A C/C++ toolchain only if `better-sqlite3` has no prebuilt binary for your platform (it usually does)

## Install & run

```bash
git clone https://github.com/Add852/diurn.git
cd diurn
npm install

# Pull the default model (llama3.2, ~2 GB)
ollama pull llama3.2

npm run dev
```

Open <http://localhost:11123> — first visit redirects to the setup screen.

## First-run setup

1. Choose a password (min. 4 chars) and your timezone. Username is `admin`.
2. Setup creates a **Default** profile with three starter questions ("What happened today?", "What are your thoughts and feels?", "One small adjustment for next time?").
3. The SQLite database is created automatically at `~/.diurn/data.db` (schema auto-migrates on first run — no manual steps).

Everything else — AI endpoint, media folder, Google integrations, Obsidian — is configured in **Settings** after login.

## Configuration

### AI

Defaults: endpoint `http://localhost:11434/v1` (Ollama's OpenAI-compatible API), model `llama3.2`. Change both in **Settings → AI**. Any OpenAI-compatible server works (LM Studio, vLLM, etc.).

- Output is capped at 1024 tokens per request (hardcoded in `src/lib/ai.ts`).
- The context window is Ollama's server-side setting; raise it at server start:
  ```bash
  OLLAMA_CONTEXT_LENGTH=16384 ollama serve
  ```
  Default is 8192 on recent Ollama. Bigger context uses more RAM/VRAM.

### Port

Default port is **11123**. Override with a shell env var (Next.js reads `PORT` before any `.env` file, so a `.env` won't work):

```bash
PORT=9000 npm run dev     # dev
PORT=9000 npm start       # production
```

### Media

Point **Settings → Media** at a local folder (e.g. your phone's camera sync). Photos/videos are scanned, EXIF dates extracted, and shown in the journal viewer with range-streamed playback. No uploads — served straight from disk.

### Google Tasks & Calendar

Provide a Google OAuth client ID/secret in **Settings**. The redirect URI is hardcoded to `http://localhost:11123/api/auth/google/callback` — register that exact URI in the [Google Console](https://console.cloud.google.com/apis/credentials). If you change the port, update the registration. Google only allows public TLDs, so from another device on your LAN you must complete the OAuth callback on the host (documented in the Settings UI).

### Obsidian

Set the vault folder in **Settings → Obsidian** to include notes from it as chat context, and write generated entries into the vault.

## Production

```bash
npm run build
npm start
```

- The PWA service worker is generated at build time (`next-pwa` is disabled during `npm run dev`).
- The session cookie is marked `secure` in production — serve over HTTPS (or keep it on localhost).
- `better-sqlite3` is externalized from the server bundle, so keep `node_modules` installed on the host; there's no Docker image.

### Data & state

| What | Where |
|---|---|
| Database | `~/.diurn/data.db` (+ `-wal`/`-shm`) |
| Session secret | `~/.diurn/session-secret` (auto-generated, mode 0600; or set `SESSION_SECRET` env) |
| Journal entries | markdown files in each profile's configured folder |

Back up `~/.diurn/` and the journal/media folders.

## Verify

```bash
npm run typecheck
npm test    # 16 node:test cases, zero test dependencies
```

## Troubleshooting

- **`better-sqlite3` fails to build** — install build tools (`python3`, `make`, `g++`; on Windows: Visual Studio Build Tools) and reinstall.
- **Chat says it can't reach the model** — confirm Ollama is running (`ollama list`) and the model is pulled; check the endpoint in **Settings → AI**.
- **Port already in use** — set `PORT` to something else (see above).
- **OAuth "redirect_uri_mismatch"** — the Google Console redirect URI must exactly match `http://localhost:11123/api/auth/google/callback`.

See `PROJECT_STATE.md` for architecture notes and the changelog.
