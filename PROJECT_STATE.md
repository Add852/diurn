# Diurn — Project State

Self-hosted daily journaling PWA. Next.js 14 (App Router) + SQLite + TypeScript.
Single admin user, iron-session cookie auth, Google Tasks/Calendar integrations,
local media folder with EXIF, AI chat-driven daily notes saved as markdown to disk.

## Stack & Conventions

- **LLM endpoint:** unset by default — any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, …), configured in Settings → AI
- **DB:** `better-sqlite3` at `~/.diurn/data.db`, schema in `src/db/schema.sql`, auto-migrated in `getDb()` with column-level `ALTER TABLE` adds.
- **Auth:** `iron-session` cookie `diurn_session`, single admin via setup flow.
- **Styling:** Tailwind CSS, `@tailwindcss/typography` for markdown prose.
- **EXIF:** `exifr` v7.1.3.
- **Video thumbnails:** `<video muted preload="auto" crossOrigin="anonymous">` + play overlay.
- **Image lightbox:** `z-[100]` above dialog `z-50`; dialog close clears lightbox.
- **Code references:** `file_path:line_number` for navigation.
- **Comments:** none unless asked. YAGNI. One-line: `[code] → skipped: [X], add when [Y].`

## Architecture (high level)

```
src/
├── lib/                 # db, auth, ai, timezone, frontmatter, template, google-auth, media-cache,
│                        #   chat-context, conversation, range, safe-return, theme
├── app/
│   ├── api/             # REST routes
│   │   ├── auth/        # login, logout, setup, google/{login,callback}
│   │   ├── chat/, entries/, media/, settings/, ai-test/
│   │   ├── fs/          # path validation + autocomplete for settings fields
│   │   └── integrations/{tasks,calendar,google-test}/status
│   ├── chat/, viewer/, settings/, setup/, login/, page.tsx + home-client.tsx
│   ├── layout.tsx       # ToastProvider, NavBar, ScanIndicator, ThemeWatcher, theme bootstrap script
│   └── globals.css      # surface/accent CSS-var ramps, 16px inputs, overflow guards
├── components/          # bottom-nav, entry-preview, entry-dialog, media-lightbox, media-thumb,
│                        #   integrations-panel, scan-indicator, scroll-reset, skeleton, theme-watcher, toast
└── middleware.ts        # redirect to /login if no diurn_session (pages only; API self-checks)
```

## Recent Decisions (chronological)

1. **Phase 1 — Chat layout:** flex-col `h-[calc(100dvh-4.5rem)]`, sticky send form, `dvh` for mobile address bar.
2. **Phase 2 — Server components:** `settings/page.tsx` and `media/page.tsx` → server SDKs preloading DB data; client components consume via props. No initial "Loading..." flash.
3. **Phase 3 — Async media scanning:** `?refresh=1` returns `{scanning: true}` immediately, scan runs in background, client polls `/api/media` until `scanning` flips off.
4. **Chat keyboard handling:** `window.visualViewport.height` → `--vvh` CSS var on `:root`. Chat container uses `chat-fill = calc(var(--vvh) - 4rem - env(safe-area-inset-bottom))`. Form is `flex-shrink-0` (not sticky), scroll region uses `min-h-0` so `overflow-y-auto` works inside flex column.
5. **Body padding:** `pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0` matches actual nav height including iOS home indicator. `safe-bottom` moved inside nav's inner flex container.
6. **EntryPreview extraction:** shared component for frontmatter grid + markdown body. Both viewer dialog and chat preview consume it. Chat dropped `preview.answers` and "Raw answers" panel.
7. **Unified `/viewer` page:** mode toggle Journal | Media. `/media` is `redirect("/viewer?mode=media")`. Nav dropped Media tab (4 → 3 tabs).
8. **Dropped month/year picker:** both views show everything, segmented by sticky month headers (journal) or sticky day headers (media). `PAGE_SIZE = 100` for media with "Load more" button.
9. **Cleanup pass (-292 lines):**
   - Deleted dead `/preview` page.
   - Deleted `CameraIcon` (unused after tab merge), `dateFromFileName`, `getEntryByDate`, `getDistinctDates`, `callChatCompletion`, `chatCompletionWithTimeout` (folded into `chatCompletion(config, msgs, timeoutMs)`), `MediaFile` interface in chat, `SAMPLE_EXPORT` placeholder, `ext` field from `MediaEntry`.
   - Consolidated all date/timezone helpers in `lib/timezone.ts` (`localDate`, `dateRange`, `getOffsetMinutes`). Removed duplicate `localDate` in tasks route and `formatDate` in media-cache.
   - Consolidated Google config in `lib/google-auth.ts`. Removed duplicate `parseConfig` in callback route.
   - Typed `Profile` interface exported from `lib/db.ts`. `getActiveProfile(): Profile | undefined`. Dropped 5+ `(profile as any).timezone` casts.
   - `Profile` includes `timezone` column, `google_client_id/secret`, `media_*`, `note_scan_*`, etc. Migrations added via `addCol()` pattern in `migrateProfileColumns`.
   - Added `loadMediaContext(profileId, folder, tz, date, limit)` helper in media-cache; `entries/route.ts` uses it instead of inline scan+fetch.
   - `getDb()` extracted `migrateProfileColumns()` helper.
10. **Setup/login server-side redirects:** both pages run `hasUsers()` in the server component and `redirect()` accordingly; `export const dynamic = "force-dynamic"` keeps them uncached. (The old `/api/auth/needs-setup` endpoint was removed — no consumers.)
11. **Live media updates:** `fs.watch` singleton per profile (recursive, non-persistent). On any FS event under the folder, profile marked dirty. `_doScan` is now incremental: walks FS, only re-resolves dates for paths with mtime diff vs cache, deletes cached paths that no longer exist. `/api/media` checks `isDirty()` → next request returns `scanning: true` → existing viewer polling picks up new files automatically.
12. **Chronological per-day ordering:** added `media_cache.captured_at INTEGER` (epoch ms, nullable). Scan stores from EXIF `DateTimeOriginal` (parsed `Date`) or FS `birthtime/mtime`. EXIF date-only strings get noon UTC. Existing DBs backfill via `migrateMediaCacheColumns`: `UPDATE media_cache SET captured_at = strftime('%s', date || 'T12:00:00') * 1000`. SQL: `ORDER BY date DESC, captured_at ASC NULLS LAST, path ASC` — newest day on top, oldest capture first within day, alphabetical path as final tiebreaker for same-second bursts.
13. **Review pass (2026-08):**
   - Implemented `viewer/media-view.tsx` (was empty): carousel-per-day, infinite scroll via IntersectionObserver + offset paging, keyboard nav + arrows in lightbox. `DAY_LIMIT=500`/page.
   - `/api/media` GET: removed `limit` default overrides (month/dates no longer clobber).
   - Chat completion detection switched to **LLM heuristic**: classifier sub-call asks model if last message covers all questions (JSON `{covered, missing}`), "done"/wrap-up phrases force covered. Broken join SQL removed.
   - `/api/media/file` now guards with `getSession().userId` (401 unauth).
   - Dead code removed: `writeFrontmatter`, `_folderMeta` map, unused `stmt` in google callback, unused CSS classes.
   - Added `getProfile(id)` + typed `ProfileQuestion` in `db.ts`.
   - `api/chat/route.ts` refactored with `appendMessage`/`getMessages`/`getFullMessages` helpers; session existence via `SELECT 1`.
   - Atomic writes in `/api/entries` (`.tmp` + `renameSync`).
   - Settings tabs: pill tags → underline tab bar; `?google_ok=` renders a toast.
   - Streak derives from `entries` table (any consecutive-day entries), not insert-only `streaks` table. `streaks` kept for legacy data.
14. **Integration context (2026-08):** chat session gathers context BEFORE greeting.
   - `lib/chat-context.ts`: `buildChatContext(profile, date)` → notes + tasks + calendar, embedded in the persisted system message so every later turn + entry generation sees it. Each source fails independently (one broken source can't block greeting).
   - Obsidian notes: `obsidian_*` columns (+migration). Scan defined folder recursively; match via `created` frontmatter (bare date or naive datetime → literal day; zone-suffixed → converted) else file birthtime/ctime. Excluded dirs (comma-separated names) skipped. `obsidian_include_content` → one batched LLM call returns JSON summaries (1–3 sentences each); failure degrades to title-only.
   - Tasks/calendar fetch logic moved from status routes into `chat-context.ts` (`fetchDayTasks`/`fetchDayEvents`); routes slimmed to import them.
   - Media REMOVED from LLM context — images stay async panel-only (load time + not needed for answers).
   - `IntegrationsPanel` now renders immediately when any integration enabled (skeleton rows while loading), adds Notes section.
   - Transparency: chat preview has collapsible (hidden by default) "Raw context & input" — system prompt + user transcript + notes/tasks/calendar objects.
   - Setup: `PUT /api/settings` persists obsidian fields; Integrations tab in settings has Obsidian section.

## Open Work / Known Limitations
15. **Cleanup pass (2026-08):**
   - Shared `MediaItem` type (media-lightbox) + `MediaThumb` component replace 3 duplicated `MediaFile` interfaces and 3 video-thumb JSX blocks.
   - `src/lib/conversation.ts`: shared `appendMessage`/`getMessages`/`getFullMessages` (was duplicated in chat + entries routes). `llmConfig(profile)` helper in `ai.ts` replaces 4 inline config literals.
   - Dead code: `SkeletonRow`/`SkeletonCard`, `initialUser` prop chain (settings), `showDate` in lightbox, `fmt` unused param, `ctx.enabled` field, `conversation_messages.metadata` column (schema.sql), `/media` redirect page, empty `public/media/`.
   - Bug fixes: chat double-`?date=` URL + UTC-vs-profile-tz date default (server now returns `date`), `generateNote` error state overwritten by `complete` in `finally`, `loadPage` in-flight race in media-view, `changePassword` ignoring non-OK responses.
   - Security: OAuth `return` param sanitized (`safeReturnTo`, blocks protocol-relative + backslash), media file serving uses `realpath` containment (symlink escape), robust HTTP Range parsing (suffix ranges, clamping, 416).
   - Nav: `[transform:translateZ(0)]` removed — plain fixed; Firefox-Android-owned-layer anchoring was the last suspect for viewer nav drift. `overflow-anchor: none` kept in globals.

16. **Hardening + CI (2026-08):**
   - Sync I/O on hot paths made async: media scan walk, Obsidian notes walk, entries daily-note merge → `fs/promises` (yields between files; no event-loop stalls on large folders). `ponytail:` true parallelism (worker threads) when folder sizes warrant it.
   - Login rate limit: in-memory per-IP (5 fails → 60s lock, doubling to 15-min cap, `Retry-After` honored).
   - `lib/range.ts` (single-range parser: suffix, clamping, 416 cases) extracted from media file route; `lib/safe-return.ts` extracted from google-auth. Both unit-tested.
   - Tests: `node:test` (zero new deps), `npm test` = `node --experimental-strip-types --test`; 13 tests cover range parser, redirect guard, frontmatter, template, timezone. `npm run typecheck` added. GitHub Actions `ci.yml` (typecheck + test) — runs on push/PR.
   - `entry_answers` table rebuild now inside a single transaction.
17. **Context pipeline dedup (2026-08):**
   - Chat page no longer re-fetches tasks/calendar/media: `buildChatContext` returns connection state for tasks/calendar and a media slice (`{files}` with `src`); the UI renders entirely from `context.raw`. `/api/chat` is now the only integration fetch the chat page makes.
   - Entry generation: one batched LLM call returning `{Q1:…, Q2:…}` JSON (per-question `answer_prompt` included for transparency), with a per-question fallback for any identifier the batch missed. ~3 parallel calls → 1.
   - System-prompt context is now compact JSON (`{notes, tasks, calendar}`), replacing the markdown bullet list — long multiline descriptions no longer collide with list formatting. Media stays out of the prompt (filenames carry no semantic signal) but still ships in `context.raw` for UI thumbnails.
   - Classifier now evaluates the FULL transcript (last 24 messages, 400-char truncation per message) instead of `slice(-6)`, so answers given many turns ago stop being re-asked. Stop rules: `covered: true` → wrap-up + generate note; empty `missing` (never re-asks everything) → one-line nudge; otherwise follow-up asks only genuinely missing question ids.
18. **View-entry flow + final cleanup (2026-08):**
   - Chat page: `date` now server-provided (no UTC `toISOString` default), single error state (duplicate render removed), `generateNote` reaches `complete` on overwrite-confirm. Completion shows "View entry" → `EntryDialog` (edit markdown / re-run in chat / delete). Edit hits new `/api/entries` PUT.
   - `--vvh`/`chat-fill` CSS-var scheme removed — plain `100dvh` flex column. Nav: `translateZ(0)` dropped (plain `fixed bottom-0`); `overflow-anchor: none` kept. Firefox-Android drift fix verified pinned at multiple scroll depths in Chromium + Firefox.
   - `loadPage` in-flight guard in media-view (overfetch race); `changePassword` checks `res.ok`.
19. **Port 3000 → 11123:** `npm run dev`/`start` use `-p ${PORT:-11123}` (override via `PORT=xxxx npm run dev`); `OAUTH_REDIRECT_URI` and settings UI updated to `localhost:11123`. Google Console redirect URI must be re-registered for the new port.
20. **Default LLM → Ollama:** endpoint `http://localhost:11434/v1`, model `llama3.2` — new installs, new profiles, and settings placeholders. Existing profiles keep stored values; change in Settings → AI. Requires `ollama pull llama3.2`.
21. **README.md added:** install/run/setup/config/production/troubleshooting for self-hosting.
22. **Deployability + notifications (2026-09):** `serve.sh` hardened for systemd (NODE_BIN/NPM_BIN overrides — boot PATH lacks `~/.local/bin`; unit written before build so ^C can't strand a stale unit; interactive build streaming; `command -v` preflight). Schema LLM defaults reverted to `''` — nothing configured by default; `chatCompletion` throws "AI is not configured". Toast component (`useToast`, sticky errors) replaces ad-hoc notifications; `ScanIndicator` in layout shows background media scans.
23. **Google auth fix:** redirect URI derived per-request via `oauthRedirectUri(req)` (honors `x-forwarded-host`/`proto`) instead of hardcoded `localhost:11123` — works behind TLS proxies, shown in Settings UI. LAN OAuth completion note updated accordingly.
24. **Settings improvements:** profile **export/import** — create/import goes through one whitelisted `settingCols` list in `PUT /api/settings` (import keeps what it carried; manual create falls back to defaults). `google-test` route hardened. Settings client reorganized (theme picker, accent swatches).
25. **Theming:** `lib/theme.ts` — theme mode + accent in localStorage (per-device). `THEME_BOOTSTRAP` inline `<head>` script applies before first paint (self-contained duplicate of `applyTheme` — inline scripts can't import). `globals.css` surface ramps (zinc steps as `--surface-*` RGB triplets, dark/light flip), accent ramps (`--accent-50…950`); `tailwind.config.ts` compiles them with `<alpha-value>` so all alpha variants keep working. `ThemeWatcher` syncs 'system' mode with OS changes. Accents: emerald, blue, violet, rose, amber.
26. **Chat/entry flow rework ("brudah" commit):** greeting falls back to plain question list when LLM unreachable. `one_by_one` asking method: progress = user-message count; answer for question i = user message i (raw pre-fill). Classifier safety net: unparseable output + one user msg per question → complete. Entry generation dropped the batched-JSON call → **one prose call per question** (reply text IS the answer; each failure keeps pre-fill/empty slot, never breaks the batch) + `extractionWarning` surfaced to UI. `checkCoverage` removed (classifier inline in chat route).
27. **Cleanup (2026-09):** `public/sw.js` + `workbox-*.js` un-committed and gitignored (next-pwa regenerates them per build — they were churn in every commit). Redundant `SWRegister` component deleted (`register: true` already injects workbox-window registration). Over-exported helpers internalized (`summarizeNotes`, `buildNotesContext`, `getTokens`, `refreshTokens`, `startWatcher`, `isValidAccent`, `applyThemeFromStorage`, `NoteCtx`, `GoogleTokens`, `ByteRange`, `MediaEntry`, `ChatRole`).
28. **Duplication pass:** settings-client got `settingsPut`/`refreshSettings` helpers (7 identical `PUT /api/settings` fetch blocks + 4 re-fetch-and-redistribute blocks → 2 functions; `settingsPut` throws on non-OK non-JSON, so callers can't silently swallow 500s). entries route: shared `writeNote(dir, date, content)` for the two atomic tmp+rename blocks (POST render, PUT edit).
29. **Form interface + AI toggle (2026-09):** New profile cols: `ai_enabled` (master toggle — config kept, `aiAvailable()` in ai.ts treats off == unconfigured), `ui_mode` (`form` | `chat`), `ask_mode` (`separate` | `all`), `form_output` (`raw` verbatim | `ai` refined per answer_prompt; separate-form only — all-at-once/chat output is always AI), `media_in_context` (media file paths into the AI prompt, off by default), `raw_context_enabled`+`raw_context_folder` (entry POST writes `{date}-context.json` atomically). New `GET /api/form` builds context with zero LLM calls; `/chat` page dispatches on `ui_mode`: `FormContent` (form-content.tsx) or `ChatContent`. Entries POST accepts `{answers}` (separate) / `{blob}` (all-at-once, AI-only, 400 when off) / `{session_id}` (chat); `settle()` transcript = chat messages or `user: {blob}`. Obsidian summaries no longer truncate (1400-char LLM input cap and 2000-char raw-content cap removed — whole markdown read). All-at-once form shows the asked=true questions above the textarea. Form inputs auto-grow (AutoTextarea, 1 line → content, capped 320px).
30. **AI transparency + reasoning strip (2026-09):** `chatCompletion` now strips chain-of-thought from reasoning models — `…` blocks, text before a bare closing ``, and never reads `reasoning_content`. Context distillation centralized in `distillContext()` (chat-context.ts): one function builds the sources object the LLM sees for the chat system prompt, the answer-generation calls, the raw-context panel, and `{date}-context.json` — all four agree byte-for-byte. Answer prompts live in `lib/prompt.ts` (`settleSystem`/`settleUser`): system = user's personality prompt + format guardrail (answer_prompt instructions override the default 1–3 sentence length), user = question + answer_prompt + integration sources + user input, nothing else. `{date}-context.json` records `user_input`, `integration_sources`, and every `ai_prompts` (system+user) with generated answers — written after generation. `/api/entries?date=X&raw_context=1` reads the snapshot back for the entry dialog, which renders an expandable JSON panel at its bottom only when the file exists. Raw-context panel (raw-context-panel.tsx) shows the user input, the distilled integration sources, and the exact per-question AI prompts; visible by default, per-device hide toggle in Settings → General (localStorage `diurn-show-context`). Chat/form pages forward `context_sources` to entries POST. Media appears in the panel's context sections only when `media_in_context` is on (the thumbnail gallery is UI, not AI context).
31. **Fixes (2026-09):** Chat GET greeting ternary was inverted — `ask_mode === "separate"` showed the ask-ALL instruction and vice versa; now `all` → ask ALL numbered, `separate` → ask one. asked=false questions are never shown/asked anywhere (form route dropped the AI-off fallback that turned them into inputs; with AI off they stay empty, AI-on infers them). Streak on the home page now re-fetches on `refreshKey` — deleting an entry from the dialog updates the streak immediately (was mount-only).
32. **Robust generation + descriptive errors (2026-09):** `chatCompletion` now retries failed requests (network errors, timeouts, 429, 5xx) with exponential backoff (base delay doubling, `Retry-After` honored on 429, capped 30s); auth/404/4xx are never retried. New profile cols `llm_retries` (0–5, default 2), `llm_retry_delay_ms` (default 1000), `llm_timeout_ms` (default 120000, per attempt) — editable in Settings → AI → Reliability expander; server clamps via `clampInt`. Default timeout raised 30s→120s (thinking models were dying mid-reasoning); `max_tokens` 1024→4096. HTTP statuses map to human reasons (401→"authentication failed — check your API key", 429→"rate limit exceeded", 404→"endpoint not found — URL should end in /v1", 413→"request too large", 5xx→"server overloaded or restarting"), and error bodies are parsed for the server's own message (OpenAI `{error:{message}}`, Ollama `{error}`, plain text). Network fetch failures describe the cause (`ECONNREFUSED` → "is the LLM server running at that address?", `ENOTFOUND` → "hostname could not be resolved"). Entries POST records per-question failures: `extraction_warning` now names which identifiers failed and the concrete error ("AI failed for Q1, Q3 — LLM error 429 (rate limit exceeded): …"), distinguishes "no relevant input" from failures, and form save errors stay visible in-page instead of a toast-only flash. stripThinking rewritten: bare trailing `</think>` splits thinking/answer correctly (Ollama R1 style; all-thinking reply → empty). Form route: asked=false questions show as inputs when AI is off or output is raw (no AI pass will infer them). 25 node:test cases incl. a mock-server test covering retry-then-succeed, no-retry-on-401, 503 exhaustion, and thinking strip.
37. **Viewer tab-switch fix (2026-09):** The Journal/Media toggle was the sluggishness source, not navigation caching: mode switching ran `router.replace(?mode=…)` (an RSC payload refetch per click) AND unmounted the inactive view, so every switch re-fetched /api/entries and all media and rebuilt the whole grid. Viewer tabs are now pure client state (useState, no router round-trip; ?mode= deep links still honored at mount), both views stay mounted after first open (lazy: a view fetches its data only when first opened), and each owns its scroll container inside an absolutely-positioned overlay pair — the inactive view is `visibility: hidden` (layout kept, so scrollTop survives; paint skipped; pointerEvents none) instead of `content-visibility: hidden` (which skips layout, collapsing scrollHeight and losing scroll position). Tab switches are now instant with full state and scroll preserved.
36. **Performance round (2026-09):** Scan-time thumbnail pipeline — sharp generates 400px WebP thumbs into ~/.diurn/thumbs/<profileId>/<sha1(path)>.webp during media scans (mtime-keyed, HEIC transcodes to viewable WebP as a side effect, EXIF rotation honored), media_cache gains a thumb column (schema + migration), /api/media/file gains ?size=thumb (falls back to the original when no thumb exists), /api/media returns a thumb src per file, and every grid surface (viewer grid, journal thumbnails, entry-dialog strip, integrations panel) serves thumbs — the lightbox alone loads full-res, with ±1 neighbor Image() prefetch for instant next/prev. Navigation: removed the obsolete experimental.staleTimes.dynamic=0 override (it disabled the router cache and re-fetched every page on back/forward; settings freshness is handled by router.refresh() after save), so back/forward restores pages with scroll and loaded media. Service worker: new CacheFirst route for /api/media/file (diurn-media cache, 300 entries, 30-day LRU) — revisits and offline browsing are instant and it doubles as "cache what was viewed". Minor fixes: .media-loading now paints a dark zinc background (Chrome's default white behind progressive-JPEG lines) and font-size:0 hides alt text during load; grid tiles pass alt="" (filename adds nothing); the chat page no longer renders the "AI is not available" error twice (standalone paragraph removed, Retry block kept); journal-view switched from column-first CSS multi-column masonry to a row-major grid (grid-cols-2/3/4) so entries read chronologically left-to-right as expected. New dep: sharp. 28 node:test cases (new sharp pipeline smoke test).
35. **Architecture clean round (2026-09):** Functionality-preserving cleanup. Bug fixes surfaced by the audit: fresh-install setup INSERTs the dropped `asking_method` column (would 500 at setup — now inserts ui_mode/ask_mode); `llmConfig` now nulls the endpoint when `ai_enabled=0` so /api/form's obsidian summarizeNotes can't call the LLM with AI toggled off (disabled AI now truly behaves like unconfigured everywhere); the raw-context panel's integration block now byte-matches settle() via shared `integrationContextBlock` in prompt.ts (was `--- Context ---`, settle uses `--- Context for {date} ---`). Dedup: `enabledIntegrationKeys` in chat-context.ts and `kickMediaScan` in media-cache.ts replace the twin blocks in /api/chat and /api/form; entries POST/PUT/DELETE + chat GET use `requireProfile()` instead of hand-rolled auth+profile boilerplate; settings-client handleSave uses the existing settingsPut helper; journal-view month labels use formatTemplateDate("MMMM yyyy") instead of its own month-name table. Dead code removed: `context` field in client POST bodies (server never read it), chat GET's `asking_method`/`total_questions`/`remaining_identifiers` and form GET's `context_media_included` (no client read them), `aiOn` hand-rolls replaced by `aiAvailable()`. Verified: typecheck, 27/27 tests, knip clean, build green.
34. **Thinking/reasoning toggle (2026-09):** New profile col `llm_thinking` (INTEGER, default 0 = off) in Settings → AI → Reliability. Off sends `think:false` + `enable_thinking:false` (Ollama/Qwen switches); on sends both true. The model landscape is heterogeneous — some models think by default, some can't at all, some strict servers 400 unknown params — so a 400/422 with the params present triggers one negotiated retry without them, memoized per endpoint+model (in-process set), and `stripThinking` still strips any reasoning that leaks through regardless of the toggle. Two new mock-server tests (negotiation + memoization, and think:true passthrough); 27 node:test cases total.
33. **Minor fixes (2026-09):** (a) "API key is required" from keyless servers — some OpenAI-compatible gateways reject requests that lack an Authorization header outright, so `chatCompletion` now always sends `Authorization: Bearer none` when no key is set. (b) asked=false questions are never shown in the form interface either — full parity with chat; the manual-input exception from item 32 is reverted (with AI off they stay empty). (c) `ai_enabled` never persisted OFF — the PUT binding was `p.ai_enabled === false ? 0 : 1`, strict-equal to `false` is never true for the numeric `0` the UI sends, so unchecking wrote 1. Now `p.ai_enabled ? 1 : 0`. Import/create path also gained numeric defaults (`ai_enabled` 1, retries 2, delay 1000, timeout 120000, day_offset 0) so INTEGER columns can't receive `""`. (d) Media loading unified under one shimmer animation: new `MediaSkeleton`/`MediaSkeletonGrid` (src/components/media-skeleton.tsx) + `.media-loading`/`.media-shimmer` in globals.css — imgs/videos animate background-position (bitmap paints over it, class drops on load), skeleton tiles sweep a translateX overlay. Applied to viewer masonry + scanning line, viewer loading page tiles, IntegrationsPanel loading dots and raw imgs (now MediaImage), and entry previews via the existing MediaImage/MediaThumb (which swapped pulse for shimmer).
- **OAuth redirect URI derived from request origin** (`oauthRedirectUri`, honoring `x-forwarded-*`): works behind reverse proxies. Google still requires public TLDs — LAN-IP access needs OAuth completed on the host (documented in settings UI).
- **File watcher doesn't survive process restart:** first request after restart may serve stale cache until next watcher fire. Workaround: Re-scan button.
- **Tests:** `node:test` in `tests/core.test.ts` — 23 cases (range parser, safe-return, frontmatter, template, timezone, extractJson, answer generation, profile export/import). `npm test` + `npm run typecheck` wired; CI runs both.
- **`/media` page deleted** (was redirect to `/viewer?mode=media`); route is now 404. Not linked from anywhere.

## Key Files & Their Roles

| File | Role |
|---|---|
| `src/lib/db.ts` | `Profile` type, `getDb()` (auto-migrate, inode-watch for replaced files), `getActiveProfile`, `getProfileQuestions`, `getStreakStatus`, `hasUsers`. |
| `src/lib/auth.ts` | `iron-session` config (Secure flag only when request is HTTPS via `x-forwarded-proto`), `hashPassword`/`verifyPassword` (scrypt + timingSafeEqual), `requireAuth`, `requireProfile`, per-IP login rate limit. |
| `src/lib/ai.ts` | `llmConfig(profile)`, `extractJson`, `chatCompletion(config, msgs, timeoutMs)` — throws when unconfigured, 1024-token cap. |
| `src/lib/timezone.ts` | `localDate(epochMs|Date, tz)`, `dateRange(reqUrl, tz)`. |
| `src/lib/frontmatter.ts` | `parseFrontmatter` splits `---` metadata from markdown body. |
| `src/lib/template.ts` | `renderTemplate` replaces `{key.question}` / `{key.answer}` / `{date}` / `{day_of_week}` / `{day_number}`. |
| `src/lib/google-auth.ts` | `oauthRedirectUri(req)` (origin-derived, proxy-aware), `parseConfig`, `ensureAccessToken(profile, integrationKey)`. |
| `src/lib/media-cache.ts` | `scanMediaFolder`, `getMediaFiles`, `loadMediaContext`, `needsRefresh`, `isDirty`. Singleton `fs.watch` per profile. Incremental scan. |
| `src/app/api/chat/route.ts` | GET: create session + first question. POST: store user msg, ask next. Returns `enabled_integrations`. |
| `src/app/api/entries/route.ts` | GET: list entries + read from `daily_note_folder` for unsynced. POST: per-question prose LLM calls (pre-fill + `extractionWarning` on failures), render template, atomic tmp+rename write, save `entry_answers`. PUT: edit existing entry, keeps Obsidian file in sync. |
| `src/app/api/settings/route.ts` | GET: profile + questions + user + template content. PUT: profile update, questions CRUD, create/delete/activate/export/import profile (whitelisted `settingCols`), change password. |
| `src/app/api/media/route.ts` | GET list with date/dates/month/limit/offset filters. Triggers background scan if dirty or `needsRefresh`. |
| `src/app/api/media/file/route.ts` | Stream file with Range/ETag/304 support. Path validated inside `media_folder`. |
| `src/app/api/integrations/tasks/status/route.ts` | Lists tasks; completed today by EXIF-style `localDate(t.completed, tz) === dateStr`, falls back to due-date tasks. |
| `src/app/api/integrations/calendar/status/route.ts` | Calendar events for the local day via `dateRange`. |
| `src/app/api/integrations/google-test/route.ts` | Tests Google client creds, token freshness, live API calls. |
| `src/app/api/auth/google/{login,callback}/route.ts` | OAuth state cookie = `{csrf}.{service}.{base64url(returnPath)}`. Callback decodes, stores tokens per integration. Redirect URI via `oauthRedirectUri(req)`. |
| `src/app/api/fs/route.ts` | Path validation (`?check=`) + filesystem autocomplete (`?dir=`) for folder/template settings fields. |
| `src/app/chat/page.tsx` | Flex-col `h-full` chat; form is flex-shrink-0 (non-sticky), scroll region `min-h-0`. `IntegrationsPanel`, collapsible "Raw context & input", "View entry" → `EntryDialog` when complete. |
| `src/app/viewer/page.tsx` | Unified Journal/Media. `JournalView` (masonry by month) + `MediaView` (grid by day). No picker. |
| `src/app/settings/{page,settings-client}.tsx` | Server reads initial data; client manages draft + dirty state + Save. |
| `src/components/bottom-nav.tsx` | Tabs: Home, Journal, Settings. `fixed bottom-0 h-14`, no compositor hacks. |
| `src/components/entry-preview.tsx` | `FM_LABELS`, `fmt`, `EntryPreview` (markdown + FM grid, optional collapsible header). |
| `src/middleware.ts` | Matcher excludes `_next`, `favicon`, all `api` (routes self-check auth), `sw.js`, `workbox-*`, `manifest`, icons, `login`, `setup`. Redirects unauth to `/login`. |

## Style Reminders for Continuation

- Terse: fragments OK, exact technical terms.
- Lazy: smallest diff that works; explain lazier alt + when to upgrade.
- YAGNI: don't add abstractions for one caller.
- No comments unless asked.
- One-line summary pattern: `[code] → skipped: [X], add when [Y].`
- Auto-clarity for security warnings, irreversible actions, multi-step sequences.

## Useful Commands

```bash
# Build + typecheck
npx tsc --noEmit
npm run build

# Watch dev
npm run dev

# Reset DB
rm ~/.diurn/data.db ~/.diurn/data.db-wal ~/.diurn/data.db-shm
```
