import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import HomeClient from "./home-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const exists = getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(session.userId);
  if (!exists) redirect("/login");
  return <HomeClient />;
}
