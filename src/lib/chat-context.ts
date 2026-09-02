import { existsSync } from "fs";
import { readFile, readdir, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { chatCompletion, extractJson } from "./ai";
import type { Profile } from "./db";
import { parseFrontmatter } from "./frontmatter";
import { localDate, dateRange } from "./timezone";
import { getMediaFiles } from "./media-cache";
import { ensureAccessToken } from "./google-auth";

export interface ChatContextBundle {
  text: string;
  raw: {
    notes: NoteCtx[];
    tasks: { connected: boolean; reason?: string; tasks: TaskCtx[] };
    calendar: { connected: boolean; reason?: string; events: EventCtx[] };
    media: { files: { name: string; path: string; date?: string; src: string; type: string }[] };
  };
}

const NOTES_LIMIT = 20;
const NOTE_BODY_CHARS = 1400;

export interface NoteCtx {
  name: string;
  path: string;
  summary?: string;
}

export interface TaskCtx {
  title: string;
  status: string;
  listName: string;
  description?: string;
}

export interface EventCtx {
  summary: string;
  start: string;
  location?: string;
  description?: string;
}

type LlmConfig = { endpoint: string; apiKey: string; model: string };

async function noteDate(filePath: string, timezone?: string, offsetHours?: number): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    const created = parseFrontmatter(content).data.created;
    if (created) {
      const raw = String(created).trim();
      const bare = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
      if (bare && !hasExplicitZone) return `${bare[1]}-${bare[2]}-${bare[3]}`;
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return localDate(d.getTime(), timezone, offsetHours);
    }
  } catch {}
  try {
    const s = await stat(filePath);
    return localDate(s.birthtimeMs || s.ctimeMs, timezone, offsetHours);
  } catch {}
  return undefined;
}

async function walkNotesFolder(folder: string, exclude: string[], tz: string | undefined, offsetHours: number | undefined, date: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      const rel = relative(folder, p);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (exclude.some((e) => rel.split(/[\\/]/).some((seg) => seg === e))) continue;
        await walk(p);
      } else if (extname(entry.name).toLowerCase() === ".md") {
        if (exclude.some((e) => rel.split(/[\\/]/).some((seg) => seg === e))) continue;
        if (await noteDate(p, tz, offsetHours) === date) found.push(p);
      }
    }
  };
  await walk(folder);
  return found;
}

export async function summarizeNotes(
  notes: { name: string; body: string }[],
  llm: LlmConfig
): Promise<Record<string, string>> {
  if (notes.length === 0) return {};
  try {
    const payload = notes
      .map((n, i) => `<note id="${i}">\n${n.body.slice(0, NOTE_BODY_CHARS)}\n</note>`)
      .join("\n\n");
    const res = await chatCompletion(llm, [
      { role: "system", content: "You summarize Obsidian notes. Respond ONLY with valid JSON: an object mapping each note id (\"0\", \"1\", ...) to a 1-3 sentence summary. Dense and factual, no preamble." },
      { role: "user", content: payload },
    ], 30000);
    const parsed = extractJson(res) || {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const note = notes[parseInt(k, 10)];
      if (note && typeof v === "string" && v.trim()) out[note.name] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export async function buildNotesContext(
  profile: Profile,
  date: string,
  llm: LlmConfig
): Promise<NoteCtx[]> {
  if (!profile.obsidian_enabled || !profile.obsidian_folder) return [];
  const folder = profile.obsidian_folder;
  if (!existsSync(folder)) return [];

  const exclude = (profile.obsidian_exclude_folders || "").split(",").map((s) => s.trim()).filter(Boolean);
  const paths = (await walkNotesFolder(folder, exclude, profile.timezone, profile.day_offset_hours, date)).slice(0, NOTES_LIMIT);
  if (paths.length === 0) return [];

  const items: NoteCtx[] = paths.map((p) => {
    const base = p.split(/[\\/]/).pop() || p;
    return {
      name: base.replace(/\.[^.]+$/, ""),
      path: p,
    };
  });

  if (!profile.obsidian_include_content) return items;

  const bodies = await Promise.all(
    paths.map(async (p) => {
      try {
        return parseFrontmatter(await readFile(p, "utf-8")).body;
      } catch {
        return "";
      }
    })
  );

  // 2 = raw note content, 1 = AI summary per note.
  if (profile.obsidian_include_content === 2) {
    for (const item of items) {
      const body = bodies[items.indexOf(item)];
      if (body.trim()) item.summary = body.trim().slice(0, 2000);
    }
    return items;
  }

  const summaries = await summarizeNotes(
    bodies.map((body, i) => ({ name: items[i].name, body })),
    llm
  );
  for (const item of items) {
    if (summaries[item.name]) item.summary = summaries[item.name];
  }
  return items;
}

export async function fetchDayTasks(
  profile: Profile,
  date: string
): Promise<{ connected: boolean; reason?: string; tasks: TaskCtx[] }> {
  if (!profile.google_tasks_enabled) {
    return { connected: false, reason: "not_enabled", tasks: [] };
  }
  const token = await ensureAccessToken(profile, "google_tasks_config");
  let cfg: any = {};
  try { cfg = JSON.parse(profile.google_tasks_config || "{}"); } catch {}
  if (!token) {
    return { connected: false, reason: cfg.tokens ? "auth_expired" : "not_authenticated", tasks: [] };
  }
  try {
    const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listsRes.ok) return { connected: false, reason: `api_error_${listsRes.status}`, tasks: [] };
    const taskLists = (await listsRes.json()).items || [];

    const completedToday: TaskCtx[] = [];
    const dueToday: TaskCtx[] = [];
    for (const list of taskLists) {
      try {
        const r = await fetch(
          `https://www.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) continue;
        for (const t of (await r.json()).items || []) {
          if (!t.title) continue;
          if (t.status === "completed" && t.completed && localDate(t.completed, profile.timezone, profile.day_offset_hours) === date) {
            completedToday.push({ title: t.title, status: t.status, listName: list.title, description: t.notes || undefined });
          } else if (t.due && t.due.startsWith(date)) {
            dueToday.push({ title: t.title, status: t.status || "needsAction", listName: list.title, description: t.notes || undefined });
          }
        }
      } catch {}
    }
    const tasks = (completedToday.length > 0 ? completedToday : dueToday).slice(0, 20);
    tasks.sort((a, b) => a.title.localeCompare(b.title));
    return { connected: true, tasks };
  } catch {
    return { connected: false, reason: "fetch_error", tasks: [] };
  }
}

export async function fetchDayEvents(
  profile: Profile,
  date: string
): Promise<{ connected: boolean; reason?: string; events: EventCtx[] }> {
  if (!profile.google_calendar_enabled) {
    return { connected: false, reason: "not_enabled", events: [] };
  }
  const token = await ensureAccessToken(profile, "google_calendar_config");
  let cfg: any = {};
  try { cfg = JSON.parse(profile.google_calendar_config || "{}"); } catch {}
  if (!token) {
    return { connected: false, reason: cfg.tokens ? "auth_expired" : "not_authenticated", events: [] };
  }
  try {
    const { min, max } = dateRange(date, profile.timezone, profile.day_offset_hours);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=25`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { connected: false, reason: `api_error_${res.status}`, events: [] };
    const data = await res.json();
    const events: EventCtx[] = (data.items || []).slice(0, 25).map((e: any) => ({
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      location: e.location,
      description: e.description || undefined,
    }));
    return { connected: true, events };
  } catch {
    return { connected: false, reason: "fetch_error", events: [] };
  }
}


export async function buildChatContext(profile: Profile, date: string, llm: LlmConfig): Promise<ChatContextBundle> {
  const notes = await buildNotesContext(profile, date, llm);
  const tasks = await fetchDayTasks(profile, date);
  const calendar = await fetchDayEvents(profile, date);
  const mediaFiles = profile.media_enabled && profile.media_folder
    ? getMediaFiles({ profileId: profile.id, date, limit: 20 })
    : [];
  const media = { files: mediaFiles.map((m) => ({ ...m, src: `/api/media/file?path=${encodeURIComponent(m.path)}` })) };

  // Media is UI-only (thumbnails): filenames carry no semantic signal for the
  // model, so it stays out of the prompt but still ships in `raw` below.
  const hasContent = notes.length + tasks.tasks.length + calendar.events.length > 0;
  const sources = {
    notes: notes.map((n) => ({ name: n.name, summary: n.summary || null })),
    tasks: tasks.tasks.map((t) => ({ title: t.title, status: t.status, list: t.listName, description: t.description?.slice(0, 300) || null })),
    calendar: calendar.events.map((e) => ({ summary: e.summary, start: e.start?.slice(0, 16) || null, location: e.location || null, description: e.description?.slice(0, 300) || null })),
  };

  const contextText = hasContent
    ? `\n\n--- Context for ${date} ---\nData sources below are JSON. Use them only when relevant to the user's answers; if a few items feel worth mentioning, acknowledge them lightly in your greeting.\n${JSON.stringify(sources, null, 2)}\n---`
    : `\n\n--- Context for ${date} ---\nNo context sources produced content. Do not mention missing or failed integrations; proceed normally.\n---`;

  return {
    text: contextText,
    raw: { notes, tasks, calendar, media },
  };
}
