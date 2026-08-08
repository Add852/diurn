import { NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/db";
import { ensureAccessToken, parseConfig } from "@/lib/google-auth";

type TokenStatus = "ok" | "no_token" | "expired" | "parse_error";

export async function GET() {
  const profile = getActiveProfile();
  if (!profile) return NextResponse.json({ error: "No active profile" }, { status: 400 });

  const check = (key: "google_tasks_config" | "google_calendar_config"): TokenStatus => {
    try {
      const t = parseConfig(profile[key]).tokens;
      if (!t?.access_token) return "no_token";
      if (Date.now() > t.expires_at) return "expired";
      return "ok";
    } catch {
      return "parse_error";
    }
  };

  const tasksStatus = check("google_tasks_config");
  const calStatus = check("google_calendar_config");

  const hasCreds = !!profile.google_client_id && !!profile.google_client_secret;
  if (!hasCreds) {
    return NextResponse.json({ summary: "Google Client ID and Secret not configured.", tokens: { tasks: tasksStatus, calendar: calStatus } });
  }

  if (tasksStatus !== "ok" && calStatus !== "ok") {
    const bothMissing = tasksStatus === "no_token" && calStatus === "no_token";
    return NextResponse.json({
      summary: bothMissing
        ? "Credentials configured. Click Connect Google to authenticate."
        : `Tokens: tasks=${tasksStatus} calendar=${calStatus}. Re-authenticate.`,
      tokens: { tasks: tasksStatus, calendar: calStatus },
    });
  }

  const results: Record<string, { ok: boolean; error?: string; lists?: number; name?: string }> = {};
  const token = await ensureAccessToken(profile, tasksStatus === "ok" ? "google_tasks_config" : "google_calendar_config");
  if (!token) {
    return NextResponse.json({ summary: "Token recently expired. Re-authenticate.", tokens: { tasks: tasksStatus, calendar: calStatus } });
  }

  if (tasksStatus === "ok") {
    const r = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) results.tasks = { ok: true, lists: ((await r.json()).items || []).length };
    else results.tasks = { ok: false, error: `HTTP ${r.status}` };
  }

  if (calStatus === "ok") {
    const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) results.calendar = { ok: true, name: (await r.json()).summary };
    else results.calendar = { ok: false, error: `HTTP ${r.status}` };
  }

  const allOk = Object.values(results).every((v) => v.ok);
  const summary = allOk
    ? "Both integrations working."
    : Object.entries(results).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error}`).join("; ");

  return NextResponse.json({ tokens: { tasks: tasksStatus, calendar: calStatus }, results, summary });
}