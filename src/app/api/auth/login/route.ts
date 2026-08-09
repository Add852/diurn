import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, getSession } from "@/lib/auth";

const attempts = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 15 * 60_000;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : req.headers.get("x-real-ip")) || "local";
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  const ip = clientIp(req);
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && rec.until > now) {
    const retryAfter = Math.ceil((rec.until - now) / 1000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  if (rec) attempts.delete(ip);

  const db = getDb();
  const user = db.prepare("SELECT * FROM users ORDER BY id LIMIT 1").get() as any;
  if (!user) {
    return NextResponse.json({ error: "Not set up" }, { status: 404 });
  }

  if (!verifyPassword(password, user.password_hash, user.salt)) {
    const count = (rec?.count || 0) + 1;
    const until = count >= MAX_FAILS ? now + Math.min(LOCK_BASE_MS * 2 ** (count - MAX_FAILS), LOCK_MAX_MS) : 0;
    attempts.set(ip, { count, until });
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  attempts.delete(ip);

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  await session.save();

  return NextResponse.json({ userId: user.id });
}