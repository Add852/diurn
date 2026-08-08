import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export interface SessionData {
  userId?: number;
  username?: string;
}

const SESSION_OPTIONS: SessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  cookieName: "diurn_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
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