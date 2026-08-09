import { getDb } from "./db";
import { existsSync, watch, FSWatcher } from "fs";
import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import { localDate } from "./timezone";

const MEDIA_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov", ".mkv", ".avi", ".heic", ".heif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"]);

type ResolvedDate = { date: string; capturedAt: number | null };

async function dateFromExif(filePath: string, timezone?: string): Promise<ResolvedDate | undefined> {
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
          return { date: localDate(d, timezone), capturedAt: d.getTime() };
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

async function dateFromFS(filePath: string, timezone?: string): Promise<ResolvedDate | undefined> {
  try {
    const s = await stat(filePath);
    const ms = (s.birthtime || s.mtime).getTime();
    return { date: localDate(ms, timezone), capturedAt: ms };
  } catch {}
  return undefined;
}
async function resolveDate(filePath: string, timezone?: string): Promise<ResolvedDate> {
  return (await dateFromExif(filePath, timezone)) || (await dateFromFS(filePath, timezone)) || { date: "unknown-date", capturedAt: null };
}

export interface MediaEntry {
  path: string;
  name: string;
  date: string | undefined;
  type: "image" | "video";
}

const _scanLocks = new Map<number, Promise<number>>();
const _watchers = new Map<number, FSWatcher>();
const _dirty = new Set<number>();

export function startWatcher(folder: string, profileId: number) {
  if (_watchers.has(profileId) || !existsSync(folder)) return;
  try {
    const w = watch(folder, { recursive: true, persistent: false }, () => _dirty.add(profileId));
    w.on("error", () => {});
    _watchers.set(profileId, w);
  } catch {}
}

export async function scanMediaFolder(folder: string, profileId: number, timezone?: string): Promise<number> {
  startWatcher(folder, profileId);
  const existing = _scanLocks.get(profileId);
  if (existing) return existing;

  const promise = _doScan(folder, profileId, timezone);
  _scanLocks.set(profileId, promise);
  try {
    return await promise;
  } finally {
    _scanLocks.delete(profileId);
  }
}

async function _doScan(folder: string, profileId: number, timezone?: string): Promise<number> {
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
    "INSERT OR REPLACE INTO media_cache (path, profile_id, date, captured_at, type, mtime) VALUES (?, ?, ?, ?, ?, ?)"
  );

  if (fresh.length > 0) {
    const BATCH = 16;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH);
      const resolved = await Promise.all(batch.map((f) => resolveDate(f.path, timezone)));
      db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          insert.run(batch[j].path, profileId, resolved[j].date, resolved[j].capturedAt, batch[j].type, batch[j].mtime);
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
    .prepare(`SELECT path, date, type FROM media_cache ${where} ORDER BY date DESC, captured_at ASC NULLS LAST, path ASC ${limitClause} ${offsetClause}`)
    .all(...params) as any[];

  return rows.map((r) => ({
    path: r.path,
    name: r.path.split("/").pop()!,
    date: r.date || undefined,
    type: r.type as "image" | "video",
  }));
}

export function isDirty(profileId: number): boolean {
  return _dirty.has(profileId);
}

export function needsRefresh(profileId: number): boolean {
  const row = getDb().prepare("SELECT COUNT(*) as cnt FROM media_cache WHERE profile_id = ?").get(profileId) as { cnt: number };
  return row.cnt === 0;
}