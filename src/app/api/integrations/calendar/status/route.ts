import { NextRequest, NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/db";
import { ensureAccessToken, parseConfig } from "@/lib/google-auth";
import { dateRange } from "@/lib/timezone";

export async function GET(req: NextRequest) {
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  if (!profile.google_calendar_enabled) {
    return NextResponse.json({ connected: false, reason: "not_enabled" });
  }

  const token = await ensureAccessToken(profile, "google_calendar_config");
  if (!token) {
    const cfg = parseConfig(profile.google_calendar_config);
    return NextResponse.json({ connected: false, reason: cfg.tokens ? "auth_expired" : "not_authenticated" });
  }

  try {
    const { min, max } = dateRange(req.url, profile.timezone);

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      return NextResponse.json({ connected: false, reason: `api_error_${res.status}` });
    }

    const data = await res.json();
    const events = (data.items || []).map((e: any) => ({
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      location: e.location,
    }));

    return NextResponse.json({
      connected: true,
      count: events.length,
      events,
    });
  } catch {
    return NextResponse.json({ connected: false, reason: "fetch_error" });
  }
}