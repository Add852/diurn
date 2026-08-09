import { NextRequest, NextResponse } from "next/server";
import { getDb, getActiveProfile } from "@/lib/db";
import { parseConfig } from "@/lib/google-auth";
import { safeReturnTo } from "@/lib/safe-return";
const OAUTH_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const stateCookie = req.cookies.get("g_oauth_state")?.value;
  let returnTo = "/settings";
  let service: "both" | "tasks" | "calendar" = "both";
  if (stateCookie && state && stateCookie === state) {
    const parts = state.split(".");
    if (parts.length >= 2) {
      const s = parts[1];
      if (s === "both" || s === "tasks" || s === "calendar") service = s;
      const restIdx = ["both", "tasks", "calendar"].includes(s) ? 2 : 1;
      if (parts.length > restIdx) {
        try {
          const decoded = Buffer.from(parts[restIdx], "base64url").toString("utf8");
          returnTo = safeReturnTo(decoded);
        } catch {}
      }
    }
  }

  const errorRedirect = (msg: string) => {
    const res = NextResponse.redirect(new URL(`${returnTo}?error=${encodeURIComponent(msg)}`, req.url));
    res.cookies.delete("g_oauth_state");
    return res;
  };

  if (!code) return errorRedirect("no_code");

  const profile = getActiveProfile();
  if (!profile) return errorRedirect("no_profile");
  if (!profile.google_client_id || !profile.google_client_secret) return errorRedirect("no_creds");

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: profile.google_client_id,
        client_secret: profile.google_client_secret,
        redirect_uri: OAUTH_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) return errorRedirect(tokenData.error);

    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
    };

    const db = getDb();
    const saveConfig = (key: "google_tasks_config" | "google_calendar_config") => {
      const cfg = parseConfig(profile[key]);
      db.prepare(`UPDATE profiles SET ${key} = ? WHERE id = ?`)
        .run(JSON.stringify({ ...cfg, tokens }), profile.id);
    };

    if (service === "tasks" || service === "both") saveConfig("google_tasks_config");
    if (service === "calendar" || service === "both") saveConfig("google_calendar_config");

    const res = NextResponse.redirect(new URL(`${returnTo}?google_ok=${service}`, req.url));
    res.cookies.delete("g_oauth_state");
    return res;
  } catch (err: any) {
    return errorRedirect(err.message);
  }
}