import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getMediaFiles, isDirty, needsRefresh, scanMediaFolder, pendingScan, maybeBackgroundScan } from "@/lib/media-cache";
import { existsSync } from "fs";

export async function GET(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;

  // Lightweight poll for the global scan indicator. Does NOT wait on or start
  // a scan — just reports what the media view / settings save kicked off.
  if (new URL(req.url).searchParams.get("status") === "1") {
    const scanning = !!pendingScan(profile.id) || (!!(profile.media_enabled && profile.media_folder && existsSync(profile.media_folder)) && (isDirty(profile.id) || needsRefresh(profile.id)));
    return NextResponse.json({ scanning, enabled: !!profile.media_enabled, folder: profile.media_folder || "", folder_missing: !!profile.media_folder && !existsSync(profile.media_folder) });
  }

  if (!profile.media_enabled || !profile.media_folder) return NextResponse.json({ files: [], disabled: true, reason: "not_configured" });
  if (!existsSync(profile.media_folder)) return NextResponse.json({ files: [], disabled: true, reason: "folder_missing" });

  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "0") || 0, 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
  const filterDate = url.searchParams.get("date") || undefined;
  const filterMonth = url.searchParams.get("month") || undefined;

  maybeBackgroundScan();
  // A scan in flight (or needed) must not block serving the page: hand back
  // whatever is cached right now and let the client poll — the viewer shows
  // cached photos plus a scanning indicator and appends as the scan lands.
  // Only an explicit ?refresh=1 (user hit Rescan) resets the view.
  if (refresh) {
    scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours).catch(() => {});
    return NextResponse.json({ files: [], scanning: true });
  }
  if (needsRefresh(profile.id) || isDirty(profile.id)) {
    // Cache empty/stale: kick a background scan, and if we have nothing cached
    // yet, tell the client we're scanning instead of showing an empty gallery.
    const cached = getMediaFiles({ profileId: profile.id, limit: 1 });
    if (cached.length === 0) {
      scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours).catch(() => {});
      return NextResponse.json({ files: [], scanning: true });
    }
    scanMediaFolder(profile.media_folder, profile.id, profile.timezone, profile.day_offset_hours).catch(() => {});
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