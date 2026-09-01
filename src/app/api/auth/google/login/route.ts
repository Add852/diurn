import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { randomBytes } from "crypto";
import { safeReturnTo } from "@/lib/safe-return";
import { oauthRedirectUri } from "@/lib/google-auth";

export async function GET(req: NextRequest) {
  const guard = await requireProfile();
  if (guard instanceof NextResponse) return guard;
  const { profile } = guard;

  const url = new URL(req.url);
  const service = url.searchParams.get("service") || "tasks";

  const scopes: string[] = [];
  if (service === "tasks" || service === "both") scopes.push("https://www.googleapis.com/auth/tasks.readonly");
  if (service === "calendar" || service === "both") scopes.push("https://www.googleapis.com/auth/calendar.readonly");

  if (scopes.length === 0) return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  const clientId = (profile.google_client_id || "").trim();
  if (!clientId || !profile.google_client_secret) {
    return NextResponse.redirect(new URL("/settings", req.url));
  }

  const returnTo = safeReturnTo(url.searchParams.get("return"));
  const stateCookieValue = `${randomBytes(16).toString("hex")}.${service}.${Buffer.from(returnTo).toString("base64url")}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri(req),
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