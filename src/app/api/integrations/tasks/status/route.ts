import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { localDate } from "@/lib/timezone";
import { fetchDayTasks } from "@/lib/chat-context";

export async function GET(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;

  const date = new URL(req.url).searchParams.get("date") || localDate(new Date(), profile.timezone);
  const { connected, reason, tasks } = await fetchDayTasks(profile, date);

  return NextResponse.json({ connected, reason, count: tasks.length, tasks });
}