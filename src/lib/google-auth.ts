export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export function parseConfig(raw: string): Record<string, any> {
  try { return JSON.parse(raw); } catch { return {}; }
}

export function getTokens(config: Record<string, any>): GoogleTokens | null {
  const t = config.tokens;
  if (t?.access_token) return t as GoogleTokens;
  return null;
}

export async function refreshTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<GoogleTokens | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await res.json();
    if (data.error) return null;

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
  } catch {
    return null;
  }
}

export async function ensureAccessToken(
  profile: { id: number; google_client_id?: string; google_client_secret?: string; google_tasks_config?: string; google_calendar_config?: string },
  integrationKey: "google_tasks_config" | "google_calendar_config"
): Promise<string | null> {
  if (!profile.google_client_id || !profile.google_client_secret) return null;
  if (!profile.id) return null;

  const cfg = parseConfig((profile as any)[integrationKey] || "{}");
  let tokens = getTokens(cfg);

  if (!tokens) return null;

  if (Date.now() > tokens.expires_at - 60000) {
    if (!tokens.refresh_token) return null;
    const fresh = await refreshTokens(profile.google_client_id, profile.google_client_secret, tokens.refresh_token);
    if (!fresh) return null;
    tokens = fresh;
    const { getDb } = await import("./db");
    const db = getDb();
    const updated = parseConfig((profile as any)[integrationKey] || "{}");
    updated.tokens = tokens;
    db.prepare(`UPDATE profiles SET ${integrationKey} = ? WHERE id = ?`).run(JSON.stringify(updated), profile.id);
  }

  return tokens.access_token;
}