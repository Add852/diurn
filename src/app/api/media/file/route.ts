import { NextRequest, NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createReadStream, existsSync, statSync } from "fs";
import { extname, resolve, sep } from "path";

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
  const session = await getSession();
  if (!session.userId) {
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

  const resolved = resolve(filePath);
  const mediaRoot = resolve(profile.media_folder) + sep;

  if (resolved !== mediaRoot.slice(0, -1) && !resolved.startsWith(mediaRoot)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (!existsSync(resolved)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";

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
    const parts = range.replace("bytes=", "").split("-");
    const start = parseInt(parts[0]);
    const end = parts[1] ? parseInt(parts[1]) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = createReadStream(resolved, { start, end });
    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": String(chunkSize),
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