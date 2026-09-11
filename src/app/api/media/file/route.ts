import { NextRequest, NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { existingThumb } from "@/lib/media-cache";
import { createReadStream, existsSync, statSync, realpathSync } from "fs";
import { parseByteRange } from "@/lib/range";
import { extname, resolve, sep } from "path";

// Mirror of media-cache's THUMB_DIR — duplicated to keep this route importable
// without pulling the whole cache module server-state into route scope.
const THUMB_DIR_ROOT = resolve(process.env.HOME || "", ".diurn", "thumbs");

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return new NextResponse("No active profile", { status: 400 });
  }

  if (!profile.media_enabled || !profile.media_folder) {
    return new NextResponse("Media not configured", { status: 400 });
  }

  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    return new NextResponse("Missing path", { status: 400 });
  }

  // realpath resolves symlinks so a link inside media_folder can't escape it
  let resolved: string;
  try {
    resolved = realpathSync(resolve(filePath));
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  let mediaRoot: string;
  try {
    mediaRoot = realpathSync(resolve(profile.media_folder));
  } catch {
    return new NextResponse("Media folder unavailable", { status: 400 });
  }

  if (resolved === mediaRoot || !resolved.startsWith(mediaRoot + sep)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Grid tiles and previews ask for ?size=thumb — a 400px WebP generated at
  // scan time instead of the full original (a 4MB phone photo becomes ~30KB).
  // Falls back to the original when no thumb exists (video, sharp-decodable
  // failure, or a not-yet-rescanned library).
  if (url.searchParams.get("size") === "thumb") {
    // existingThumb stats the file on disk; the path is built from a hash of
    // (profileId, resolved path) inside ~/.diurn/thumbs — it can't point outside.
    const thumb = await existingThumb(profile.id, resolved);
    if (thumb) resolved = thumb;
  }

  if (!existsSync(resolved)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const isThumb = resolved.endsWith(".webp") && resolved.startsWith(THUMB_DIR_ROOT);
  const contentType = isThumb ? "image/webp" : MIME[extname(resolved).toLowerCase()] || "application/octet-stream";

  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const fileSize = stat.size;
  const etag = `"${stat.mtimeMs}"`;

  // Range request support (for video seeking)
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=604800, immutable",
    "Accept-Ranges": "bytes",
    "ETag": etag,
  };

  if (range) {
    const r = parseByteRange(range, fileSize);
    if (!r) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
    }
    const stream = createReadStream(resolved, { start: r.start, end: r.end });
    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${r.start}-${r.end}/${fileSize}`,
        "Content-Length": String(r.end - r.start + 1),
      },
    });
  }

  // Check If-None-Match for 304
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const stream = createReadStream(resolved);
  return new NextResponse(stream as any, {
    headers: {
      ...headers,
      "Content-Length": String(fileSize),
    },
  });
}