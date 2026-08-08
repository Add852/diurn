import { getDb, getActiveProfile, getProfileQuestions } from "@/lib/db";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const db = getDb();
  const profile = getActiveProfile();
  const profiles = db.prepare("SELECT * FROM profiles ORDER BY id").all() as any[];
  const user = db.prepare("SELECT id, username FROM users LIMIT 1").get() as any;

  let questions: any[] = [];
  if (profile) {
    questions = db.prepare("SELECT * FROM profile_questions WHERE profile_id = ? ORDER BY sort_order").all(profile.id) as any[];
  }

  return (
    <SettingsClient
      initialProfile={profile as any || null}
      initialQuestions={questions}
      initialProfiles={profiles as any}
      initialUser={user ? { id: user.id, username: user.username } : null}
    />
  );
}