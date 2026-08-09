import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { localDate } from "@/lib/timezone";
import { getActiveProfile } from "@/lib/db";
import { fetchDayEvents } from "@/lib/chat-context";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "No active profile" }, { status: 400 });
  }

  const date = new URL(req.url).searchParams.get("date") || localDate(new Date(), profile.timezone);
  const { connected, reason, events } = await fetchDayEvents(profile, date);

  return NextResponse.json({ connected, reason, count: events.length, events });
}