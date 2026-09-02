import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { ensureAccessToken, parseConfig } from "@/lib/google-auth";
import type { Profile } from "@/lib/db";

type TokenStatus = "ok" | "no_token" | "expired" | "parse_error";

function tokenStatus(profile: Profile, key: "google_tasks_config" | "google_calendar_config"): TokenStatus {
  try {
    const t = parseConfig(profile[key]).tokens;
    if (!t?.access_token) return "no_token";
    if (Date.now() > t.expires_at) return "expired";
    return "ok";
  } catch {
    return "parse_error";
  }
}

async function runTest(profile: Profile): Promise<NextResponse> {
  const tasksStatus = tokenStatus(profile, "google_tasks_config");
  const calStatus = tokenStatus(profile, "google_calendar_config");
  const tokens = { tasks: tasksStatus, calendar: calStatus };

  if (!profile.google_client_id || !profile.google_client_secret) {
    return NextResponse.json({ summary: "Google Client ID and Secret not configured.", tokens });
  }

  if (tasksStatus !== "ok" && calStatus !== "ok") {
    const bothMissing = tasksStatus === "no_token" && calStatus === "no_token";
    return NextResponse.json({
      summary: bothMissing
        ? "Credentials configured. Click Connect Google to authenticate."
        : `Tokens: tasks=${tasksStatus} calendar=${calStatus}. Re-authenticate.`,
      tokens,
    });
  }

  const token = await ensureAccessToken(profile, tasksStatus === "ok" ? "google_tasks_config" : "google_calendar_config");
  if (!token) {
    return NextResponse.json({ summary: "Token recently expired. Re-authenticate.", tokens });
  }

  const results: Record<string, { ok: boolean; error?: string; lists?: number; name?: string }> = {};
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

  return NextResponse.json({ tokens, results, summary });
}

export async function GET() {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  return runTest(guard.profile);
}

// Test using credentials posted from the Settings text fields (draft), so
// users can verify before saving. Tokens live in the saved profile config —
// testing with unsaved creds still reflects whatever tokens exist.
export async function POST(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body.client_id === "string" && body.client_id.trim() ? body.client_id.trim() : "";
  const clientSecret = typeof body.client_secret === "string" && body.client_secret.trim() ? body.client_secret.trim() : "";

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Enter a Google Client ID and Secret first." });
  }
  return runTest({ ...profile, google_client_id: clientId, google_client_secret: clientSecret });
}
