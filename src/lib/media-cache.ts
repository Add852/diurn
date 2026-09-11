import { getDb, getActiveProfile } from "./db";
import { existsSync, watch, FSWatcher } from "fs";
import { readdir, stat, mkdir, writeFile } from "fs/promises";
import { join, extname, resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { localDate } from "./timezone";

const THUMB_DIR = join(homedir(), ".diurn", "thumbs");
const THUMB_WIDTH = 400; // px — grid tiles are ~100-200px on 2x screens; 400 covers lightboxes pre-full-res nicely too
const THUMB_MAX_AGE_MS = 0; // thumbs are mtime-keyed, never stale-dated

const MEDIA_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov", ".mkv", ".avi", ".heic", ".heif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"]);

type ResolvedDate = { date: string; capturedAt: number | null };

// Thumbnail path for a media file: ~/.diurn/thumbs/<profileId>/<hash>.webp.
// Hash includes the file path so renaming an original regenerates, not
// cross-links; mtime lives in the DB row (thumb column) for cheap staleness.
function thumbPath(profileId: number, filePath: string): string {
  const h = createHash("sha1").update(filePath).digest("hex").slice(0, 24);
  return join(THUMB_DIR, String(profileId), `${h}.webp`);
}

// Generate a WebP thumbnail (side effect: HEIC becomes actually viewable in
// browsers that can't render HEIC natively). Returns null when sharp can't
// decode the file — callers keep serving the original then.
async function generateThumb(profileId: number, filePath: string): Promise<string | null> {
  const target = thumbPath(profileId, filePath);
  try {
    const sharp = (await import("sharp")).default;
    await sharp(filePath, { failOn: "none" })
      .rotate() // honor EXIF orientation
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(target);
    return target;
  } catch {
    try { (await import("fs/promises")).unlink(target).catch(() => {}); } catch {}
    return null;
  }
}

// Serve-with-fallback helper for the file route: returns the thumb path when
// one exists on disk, else null (caller serves the original).
export async function existingThumb(profileId: number, filePath: string): Promise<string | null> {
  const t = thumbPath(profileId, filePath);
  try {
    const s = await stat(t);
    if (s.isFile() && s.size > 0) return t;
  } catch {}
  return null;
}

async function dateFromExif(filePath: string, timezone?: string, offsetHours?: number): Promise<ResolvedDate | undefined> {
  if (!IMAGE_EXTS.has(extname(filePath).toLowerCase())) return undefined;
  try {
    const exifr = (await import("exifr")).default;
    const exif = await exifr.parse(filePath, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
      skip: ["MakerNote"],
    });
    if (exif) {
      const raw = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
      if (raw) {
        const d = new Date(String(raw));
        if (!isNaN(d.getTime())) {
          return { date: localDate(d, timezone, offsetHours), capturedAt: d.getTime() };
        }
        const m = String(raw).match(/(\d{4})[-:](\d{2})[-:](\d{2})/);
        if (m) {
          const noon = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
          return { date: `${m[1]}-${m[2]}-${m[3]}`, capturedAt: noon };
        }
      }
    }
  } catch {}
  return undefined;
}

async function dateFromFS(filePath: string, timezone?: string, offsetHours?: number): Promise<ResolvedDate | undefined> {
  try {
    const s = await stat(filePath);
    const ms = (s.birthtime || s.mtime).getTime();
    return { date: localDate(ms, timezone, offsetHours), capturedAt: ms };
  } catch {}
  return undefined;
}
async function resolveDate(filePath: string, timezone?: string, offsetHours?: number): Promise<ResolvedDate> {
  return (await dateFromExif(filePath, timezone, offsetHours)) || (await dateFromFS(filePath, timezone, offsetHours)) || { date: "unknown-date", capturedAt: null };
}

export function pendingScan(profileId: number): Promise<number> | undefined {
  return _scanLocks.get(profileId);
}

interface MediaEntry {
  path: string;
  name: string;
  date: string | undefined;
  type: "image" | "video";
  thumb?: string;
}

const _scanLocks = new Map<number, Promise<number>>();
const _watchers = new Map<number, FSWatcher>();
const _dirty = new Set<number>();

function startWatcher(folder: string, profileId: number) {
  if (_watchers.has(profileId) || !existsSync(folder)) return;
  try {
    const w = watch(folder, { recursive: true, persistent: false }, () => _dirty.add(profileId));
    w.on("error", () => {});
    _watchers.set(profileId, w);
  } catch {}
}

let _bootScanned = false;
// Background scan on first request after server start — warms the cache so
// chat's await path (route.ts) is a no-op in the common case. Guarded so the
// root layout's per-request render only triggers it once per process.
export function maybeBackgroundScan() {
  if (_bootScanned) return;
  _bootScanned = true;
  try {
    const profile = getActiveProfile();
    if (profile?.media_enabled && profile.media_folder) {
      scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours).catch(() => {});
    }
  } catch {}
}

// Warm the cache for a profile's media folder: fire the boot scan if this is
// the first request of the process, then kick a background rescan when the
// cache is empty or the watcher flagged the folder dirty. NEVER awaits the
// scan — a long EXIF pass used to hang the greeting behind it. Shared by
// /api/chat and /api/form so both interfaces behave identically.
export function kickMediaScan(profile: { id: number; media_enabled: number; media_folder: string; timezone?: string; day_offset_hours?: number }, folderExists: boolean) {
  if (!profile.media_enabled || !profile.media_folder || !folderExists) return;
  maybeBackgroundScan();
  if (!pendingScan(profile.id) && (needsRefresh(profile.id) || isDirty(profile.id))) {
    scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours).catch(() => {});
  }
}

export async function scanMediaFolder(folder: string, profileId: number, timezone?: string, offsetHours?: number): Promise<number> {
  startWatcher(folder, profileId);
  const existing = _scanLocks.get(profileId);
  if (existing) return existing;

  const promise = _doScan(folder, profileId, timezone, offsetHours);
  _scanLocks.set(profileId, promise);
  try {
    return await promise;
  } finally {
    _scanLocks.delete(profileId);
    _dirty.delete(profileId);
  }
}

async function _doScan(folder: string, profileId: number, timezone?: string, offsetHours?: number): Promise<number> {
  const db = getDb();
  const cached = new Map<string, number>();
  for (const r of db.prepare("SELECT path, mtime FROM media_cache WHERE profile_id = ?").all(profileId) as { path: string; mtime: number }[]) {
    cached.set(r.path, r.mtime);
  }

  const files: { path: string; name: string; mtime: number; type: "image" | "video" }[] = [];

  async function scanDir(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) subdirs.push(p);
      } else {
        const ext = extname(entry.name).toLowerCase();
        if (!MEDIA_EXTS.has(ext)) continue;
        try {
          const s = await stat(p);
          files.push({
            path: p,
            name: entry.name,
            mtime: s.mtimeMs,
            type: VIDEO_EXTS.has(ext) ? "video" : "image",
          });
        } catch {}
      }
    }
    await Promise.all(subdirs.map(scanDir));
  }

  await scanDir(folder);
  if (files.length === 0) {
    db.prepare("DELETE FROM media_cache WHERE profile_id = ?").run(profileId);
    return 0;
  }

  files.sort((a, b) => b.mtime - a.mtime);

  const fresh: typeof files = [];
  const seen = new Set<string>();
  for (const f of files) {
    seen.add(f.path);
    if (cached.get(f.path) === f.mtime) continue;
    fresh.push(f);
  }

  const insert = db.prepare(
    "INSERT OR REPLACE INTO media_cache (path, profile_id, date, captured_at, type, mtime, thumb) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  if (fresh.length > 0) {
    // Thumb dir is per-profile; create lazily before the first write.
    try { await mkdir(join(THUMB_DIR, String(profileId)), { recursive: true }); } catch {}
    const BATCH = 16;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH);
      const resolved = await Promise.all(batch.map((f) => resolveDate(f.path, timezone, offsetHours)));
      // Thumbs only for images (video keeps the metadata-poster trick) and
      // only for fresh/changed files — unchanged ones reuse the stored row.
      const thumbJobs = batch.map((f) =>
        f.type === "image" ? generateThumb(profileId, f.path) : Promise.resolve(null)
      );
      const thumbs = await Promise.all(thumbJobs);
      db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          insert.run(batch[j].path, profileId, resolved[j].date, resolved[j].capturedAt, batch[j].type, batch[j].mtime, thumbs[j] || null);
        }
      })();
    }
  }

  const staleIds = [...cached.keys()].filter((p) => !seen.has(p));
  if (staleIds.length > 0) {
    const placeholders = staleIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM media_cache WHERE profile_id = ? AND path IN (${placeholders})`).run(profileId, ...staleIds);
  }

  return files.length;
}

export function getMediaFiles(opts: {
  profileId: number;
  date?: string;
  dates?: string[];
  month?: string;
  limit?: number;
  offset?: number;
}): MediaEntry[] {
  const db = getDb();
  const conditions: string[] = ["profile_id = ?"];
  const params: any[] = [opts.profileId];

  if (opts.date) {
    conditions.push("date = ?");
    params.push(opts.date);
  } else if (opts.dates && opts.dates.length > 0) {
    const placeholders = opts.dates.map(() => "?");
    conditions.push(`date IN (${placeholders})`);
    params.push(...opts.dates);
  } else if (opts.month) {
    conditions.push("date LIKE ?");
    params.push(`${opts.month}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = opts.limit ? `LIMIT ?` : "";
  if (opts.limit) params.push(opts.limit);
  const offsetClause = opts.offset ? `OFFSET ?` : "";
  if (opts.offset) params.push(opts.offset);

  const rows = db
    .prepare(`SELECT path, date, type, thumb FROM media_cache ${where} ORDER BY date DESC, captured_at ASC NULLS LAST, path ASC ${limitClause} ${offsetClause}`)
    .all(...params) as any[];

  return rows.map((r) => ({
    path: r.path,
    name: r.path.split("/").pop()!,
    date: r.date || undefined,
    type: r.type as "image" | "video",
    thumb: r.thumb || undefined,
  }));
}

export function isDirty(profileId: number): boolean {
  return _dirty.has(profileId);
}

export function needsRefresh(profileId: number): boolean {
  const row = getDb().prepare("SELECT COUNT(*) as cnt FROM media_cache WHERE profile_id = ?").get(profileId) as { cnt: number };
  return row.cnt === 0;
}