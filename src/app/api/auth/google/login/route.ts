import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveProfile } from "@/lib/db";
import { randomBytes } from "crypto";
import { safeReturnTo } from "@/lib/safe-return";

const OAUTH_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = getActiveProfile();
  if (!profile) return NextResponse.json({ error: "No active profile" }, { status: 400 });

  const url = new URL(req.url);
  const service = url.searchParams.get("service") || "tasks";

  const scopes: string[] = [];
  if (service === "tasks" || service === "both") scopes.push("https://www.googleapis.com/auth/tasks.readonly");
  if (service === "calendar" || service === "both") scopes.push("https://www.googleapis.com/auth/calendar.readonly");

  if (scopes.length === 0) return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  if (!profile.google_client_id || !profile.google_client_secret) {
    return NextResponse.redirect(new URL("/settings", req.url));
  }

  const returnTo = safeReturnTo(url.searchParams.get("return"));
  const stateCookieValue = `${randomBytes(16).toString("hex")}.${service}.${Buffer.from(returnTo).toString("base64url")}`;

  const params = new URLSearchParams({
    client_id: profile.google_client_id,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: stateCookieValue,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set("g_oauth_state", stateCookieValue, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}