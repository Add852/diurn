import { getDb, getActiveProfile, getProfileQuestions } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import { headers } from "next/headers";
import { SettingsClient } from "./settings-client";

// Server data (active profile, questions, template file) — must render per request.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = getDb();
  const profile = getActiveProfile();
  const profiles = db.prepare("SELECT * FROM profiles ORDER BY id").all() as any[];

  let questions: any[] = [];
  if (profile) {
    questions = db.prepare("SELECT * FROM profile_questions WHERE profile_id = ? ORDER BY sort_order").all(profile.id) as any[];
  }

  let templateContent: string | null = null;
  if (profile?.template_note_path && existsSync(profile.template_note_path)) {
    try {
      templateContent = readFileSync(profile.template_note_path, "utf-8");
    } catch {}
  }

  // The exact OAuth redirect URI the user must register in the Google console
  // for THIS deployment (honors x-forwarded-* behind a reverse proxy).
  const h = await headers();
  const xfHost = h.get("x-forwarded-host");
  const googleRedirectUri = xfHost
    ? `${h.get("x-forwarded-proto") || "http"}://${xfHost}/api/auth/google/callback`
    : `http://${h.get("host") || "localhost:11123"}/api/auth/google/callback`;

  return (
    <SettingsClient
      initialProfile={profile as any || null}
      initialQuestions={questions}
      initialProfiles={profiles as any}
      initialTemplateContent={templateContent}
      googleRedirectUri={googleRedirectUri}
    />
  );
}