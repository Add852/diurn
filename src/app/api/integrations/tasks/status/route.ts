import { NextRequest, NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/db";
import { ensureAccessToken, parseConfig } from "@/lib/google-auth";
import { localDate } from "@/lib/timezone";

export async function GET(req: NextRequest) {
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  if (!profile.google_tasks_enabled) {
    return NextResponse.json({ connected: false, reason: "not_enabled" });
  }

  const token = await ensureAccessToken(profile, "google_tasks_config");
  if (!token) {
    const cfg = parseConfig(profile.google_tasks_config);
    return NextResponse.json({ connected: false, reason: cfg.tokens ? "auth_expired" : "not_authenticated" });
  }

  const dateStr = new URL(req.url).searchParams.get("date") || new Date().toISOString().split("T")[0];
  const tz = profile.timezone;

  try {
    const listsRes = await fetch(
      "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listsRes.ok) {
      return NextResponse.json({ connected: false, reason: `api_error_${listsRes.status}` });
    }
    const taskLists = (await listsRes.json()).items || [];

    const completedToday: { title: string; status: string; listName: string }[] = [];
    const dueToday: { title: string; status: string; listName: string }[] = [];

    for (const list of taskLists) {
      try {
        const r = await fetch(
          `https://www.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) continue;
        for (const t of (await r.json()).items || []) {
          if (!t.title) continue;
          if (t.status === "completed" && t.completed && localDate(t.completed, tz) === dateStr) {
            completedToday.push({ title: t.title, status: t.status, listName: list.title });
          } else if (t.due && t.due.startsWith(dateStr)) {
            dueToday.push({ title: t.title, status: t.status || "needsAction", listName: list.title });
          }
        }
      } catch {}
    }

    const tasks = (completedToday.length > 0 ? completedToday : dueToday).slice(0, 10);
    tasks.sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ connected: true, count: tasks.length, tasks });
  } catch {
    return NextResponse.json({ connected: false, reason: "fetch_error" });
  }
}