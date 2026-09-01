import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { requireAuth } from "@/lib/auth";

// GET /api/fs?check=<path>&kind=dir|md  -> { ok: boolean, reason?: string }
// GET /api/fs?dir=<partial-path>&filter=dir|md -> { dir, entries: [...] }
//   Autocomplete: treats input as "parent-dir + partial-name".
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const check = url.searchParams.get("check");
  if (check !== null) return checkPath(check, (url.searchParams.get("kind") as "dir" | "md") || "dir");

  const filter = url.searchParams.get("filter");
  const input = url.searchParams.get("dir") || "/";

  // Split into parent dir + prefix. "/home/to" -> parent "/home", prefix "to".
  let dir = input;
  let prefix = "";
  const sep = input.lastIndexOf("/");
  if (sep > 0) {
    prefix = input.slice(sep + 1);
    dir = input.slice(0, sep) || "/";
  } else if (sep === 0 && input.length > 1) {
    prefix = input.slice(1);
    dir = "/";
  }

  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return NextResponse.json({ dir, entries: [] });
  }

  const entries: { name: string; path: string; isDir: boolean }[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    if (prefix && !d.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    if (d.isDirectory()) {
      entries.push({ name: `${d.name}/`, path: join(dir, d.name), isDir: true });
    } else if (filter === "md" && d.isFile() && d.name.toLowerCase().endsWith(".md")) {
      entries.push({ name: d.name, path: join(dir, d.name), isDir: false });
    }
  }
  entries.sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name));
  return NextResponse.json({ dir, entries });
}

async function checkPath(p: string, kind: "dir" | "md"): Promise<NextResponse> {
  const trimmed = p.trim();
  if (!trimmed) return NextResponse.json({ ok: true }); // empty = unset, allowed
  let s;
  try {
    s = await stat(trimmed);
  } catch {
    return NextResponse.json({ ok: false, reason: "Path not found" });
  }
  if (kind === "dir" && !s.isDirectory()) {
    return NextResponse.json({ ok: false, reason: "Not a folder" });
  }
  if (kind === "md" && (!s.isFile() || !trimmed.toLowerCase().endsWith(".md"))) {
    return NextResponse.json({ ok: false, reason: "Not a .md file" });
  }
  return NextResponse.json({ ok: true });
}
