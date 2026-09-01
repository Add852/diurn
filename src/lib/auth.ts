import { NextResponse } from "next/server";
import { getIronSession, SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getActiveProfile, type Profile } from "./db";

// Stable per-install secret so sessions survive restarts without hardcoding a
// forgeable value in source. SESSION_SECRET env wins; otherwise persist one.
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = join(homedir(), ".diurn");
  const file = join(dir, "session-secret");
  try {
    if (existsSync(file)) {
      const s = readFileSync(file, "utf-8").trim();
      if (s.length >= 32) return s;
    }
    const s = randomBytes(32).toString("hex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch {
    console.warn("[auth] could not persist SESSION_SECRET — sessions reset on restart");
    return randomBytes(32).toString("hex");
  }
}
export interface SessionData {
  userId?: number;
  username?: string;
}

// Cookie security is decided per request: only mark Secure when the request
// actually arrived over HTTPS (i.e. behind a TLS-terminating reverse proxy,
// which sends x-forwarded-proto: https). Unconditionally Secure in production
// breaks plain-HTTP LAN access — the browser silently drops the cookie and
// login loops forever, which looks like "wrong password".
// ponytail: direct `next start` over TLS isn't supported anyway; if you ever
// do that without a proxy, the cookie just won't carry the Secure flag.
async function sessionOptions(): Promise<SessionOptions> {
  const proto = (await headers()).get("x-forwarded-proto") || "";
  return {
    password: sessionSecret(),
    cookieName: "diurn_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production" && proto.includes("https"),
      httpOnly: true,
      sameSite: "lax",
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, await sessionOptions());
}

export async function requireAuth() {
  const session = await getSession();
  return session.userId ? session : null;
}

export async function requireProfile(): Promise<NextResponse | { session: SessionData; profile: Profile }> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = getActiveProfile();
  if (!profile) return NextResponse.json({ error: "No active profile" }, { status: 400 });
  return { session, profile };
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(
  password: string,
  hash: string,
  salt: string
): boolean {
  const input = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (input.length !== expected.length) return false;
  return timingSafeEqual(input, expected);
}