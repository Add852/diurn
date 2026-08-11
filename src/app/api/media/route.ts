import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveProfile } from "@/lib/db";
import { getMediaFiles, isDirty, needsRefresh, scanMediaFolder, pendingScan, maybeBackgroundScan } from "@/lib/media-cache";
import { existsSync } from "fs";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = getActiveProfile();
  if (!profile) return NextResponse.json({ error: "No active profile" }, { status: 400 });
  if (!profile.media_enabled || !profile.media_folder) return NextResponse.json({ files: [], disabled: true });
  if (!existsSync(profile.media_folder)) return NextResponse.json({ files: [], disabled: true });

  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "0") || 0, 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
  const filterDate = url.searchParams.get("date") || undefined;
  const filterMonth = url.searchParams.get("month") || undefined;

  maybeBackgroundScan();
  const pending = pendingScan(profile.id);
  if (pending) await pending;

  if (refresh || needsRefresh(profile.id) || isDirty(profile.id)) {
    scanMediaFolder(profile.media_folder, profile.id, profile.timezone).catch(() => {});
    return NextResponse.json({ files: [], scanning: true });
  }

  const opts: Parameters<typeof getMediaFiles>[0] = {
    profileId: profile.id,
    date: filterDate,
    month: filterMonth,
    limit: limit,
    offset,
  };

  const filterDates = url.searchParams.get("dates");
  if (filterDates) {
    opts.dates = filterDates.split(",").map((d) => d.trim()).filter(Boolean);
  }

  const files = getMediaFiles(opts).map((e) => ({
    name: e.name,
    path: e.path,
    date: e.date,
    src: `/api/media/file?path=${encodeURIComponent(e.path)}`,
    type: e.type,
  }));

  return NextResponse.json({ files });
}