# Diurn — Project State

Self-hosted daily journaling PWA. Next.js 14 (App Router) + SQLite + TypeScript.
Single admin user, iron-session cookie auth, Google Tasks/Calendar integrations,
local media folder with EXIF, AI chat-driven daily notes saved as markdown to disk.

## Stack & Conventions

- **LLM endpoint:** `http://localhost:20128/v1`, model: `freethinkers`
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
├── lib/                 # db, auth, ai, timezone, frontmatter, template, google-auth, media-cache
├── app/
│   ├── api/             # REST routes
│   │   ├── auth/        # login, logout, setup, needs-setup, google/{login,callback}
│   │   ├── chat/, entries/, media/, settings/, ai-test/
│   │   └── integrations/{tasks,calendar,google-test}/status
│   ├── chat/, viewer/, settings/, media/, setup/, login/, preview/, page.tsx
│   ├── layout.tsx       # body padding calc(4rem + safe-area-inset-bottom)
│   └── globals.css      # --vvh, .chat-fill, .safe-bottom, .keyboard-safe
├── components/          # bottom-nav, entry-preview, skeleton
└── middleware.ts        # redirect to /login if no diurn_session
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
10. **`/api/auth/needs-setup` GET endpoint:** replaces login's hack of POSTing empty body to `/setup`. Login useEffect now `fetch("/api/auth/needs-setup").then(d => d.needs_setup && router.push("/setup"))`.
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

## Open Work / Known Limitations

- **OAUTH_REDIRECT_URI hardcoded to `http://localhost:3000/api/auth/google/callback`:** Google requires public TLD. LAN access needs server-side OAuth completion (documented in settings UI as a warning).
- **File watcher doesn't survive process restart:** first request after restart may serve stale cache until next watcher fire. Workaround: Re-scan button.
- **No tests:** ad-hoc assert-based checks only. Trivial one-liners need no test.
- **`/preview` page deleted** but its route path is now 404. Not linked from anywhere.
- **Settings timezone list:** hardcoded list of ~25 IANA zones in settings-client.tsx. Could use `Intl.supportedValuesOf("timeZone")` but browser support varies.

## Key Files & Their Roles

| File | Role |
|---|---|
| `src/lib/db.ts` | `Profile` type, `getDb()` (auto-migrate), `getActiveProfile`, `getProfileQuestions`, `getStreakCount`, `hasUsers`. |
| `src/lib/auth.ts` | `iron-session` config, `hashPassword`/`verifyPassword` (scrypt + timingSafeEqual). |
| `src/lib/ai.ts` | `chatCompletion(config, msgs, timeoutMs)`, `checkCoverage`. |
| `src/lib/timezone.ts` | `localDate(epochMs|Date, tz)`, `dateRange(reqUrl, tz)`. |
| `src/lib/frontmatter.ts` | `parseFrontmatter`, `writeFrontmatter`. |
| `src/lib/template.ts` | `renderTemplate` replaces `{key.question}` / `{key.answer}` / `{date}` / `{day_of_week}` / `{day_number}`. |
| `src/lib/google-auth.ts` | `parseConfig`, `getTokens`, `refreshTokens`, `ensureAccessToken(profile, integrationKey)`. |
| `src/lib/media-cache.ts` | `scanMediaFolder`, `getMediaFiles`, `loadMediaContext`, `needsRefresh`, `isDirty`. Singleton `fs.watch` per profile. Incremental scan. |
| `src/app/api/chat/route.ts` | GET: create session + first question. POST: store user msg, ask next. Returns `enabled_integrations`. |
| `src/app/api/entries/route.ts` | GET: list entries + read from `daily_note_folder` for unsynced. POST: generate note via template + per-question LLM call, write file, save `entry_answers`. |
| `src/app/api/settings/route.ts` | GET: profile + questions + user. PUT: profile update, questions CRUD, create/delete/activate/export profile, change password. |
| `src/app/api/media/route.ts` | GET list with date/dates/month/limit/offset filters. Triggers background scan if dirty or `needsRefresh`. |
| `src/app/api/media/file/route.ts` | Stream file with Range/ETag/304 support. Path validated inside `media_folder`. |
| `src/app/api/integrations/tasks/status/route.ts` | Lists tasks; completed today by EXIF-style `localDate(t.completed, tz) === dateStr`, falls back to due-date tasks. |
| `src/app/api/integrations/calendar/status/route.ts` | Calendar events for the local day via `dateRange`. |
| `src/app/api/integrations/google-test/route.ts` | Tests Google client creds, token freshness, live API calls. |
| `src/app/api/auth/google/{login,callback}/route.ts` | OAuth state cookie = `{csrf}.{service}.{base64url(returnPath)}`. Callback decodes, stores tokens per integration. |
| `src/app/chat/page.tsx` | Flex-col chat with `chat-fill`, visualViewport `--vvh`, `IntegrationsPanel`, sticky send form. `EntryPreview` collapsible. |
| `src/app/viewer/page.tsx` | Unified Journal/Media. `JournalView` (masonry by month) + `MediaView` (grid by day). No picker. |
| `src/app/settings/{page,settings-client}.tsx` | Server reads initial data; client manages draft + dirty state + Save. |
| `src/app/media/page.tsx` | One-line `redirect("/viewer?mode=media")`. |
| `src/components/bottom-nav.tsx` | Tabs: Home, Journal, Settings. Hidden on `/login` and `/setup`. |
| `src/components/entry-preview.tsx` | `FM_LABELS`, `fmt`, `EntryPreview` (markdown + FM grid, optional collapsible header). |
| `src/middleware.ts` | Matcher excludes `_next`, `favicon`, `api/auth`, `login`, `setup`. Redirects unauth to `/login`. |

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
