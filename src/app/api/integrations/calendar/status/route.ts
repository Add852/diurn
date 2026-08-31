import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { localDate } from "@/lib/timezone";
import { fetchDayEvents } from "@/lib/chat-context";

export async function GET(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;

  const date = new URL(req.url).searchParams.get("date") || localDate(new Date(), profile.timezone, profile.day_offset_hours);
  const { connected, reason, events } = await fetchDayEvents(profile, date);

  return NextResponse.json({ connected, reason, count: events.length, events });
}