import { getDb, getActiveProfile, getProfileQuestions } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
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

  return (
    <SettingsClient
      initialProfile={profile as any || null}
      initialQuestions={questions}
      initialProfiles={profiles as any}
      initialTemplateContent={templateContent}
    />
  );
}