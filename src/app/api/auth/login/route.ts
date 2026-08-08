import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as any;
  if (!user) {
    return NextResponse.json({ error: "Not set up" }, { status: 404 });
  }

  if (!verifyPassword(password, user.password_hash, user.salt)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  await session.save();

  return NextResponse.json({ userId: user.id });
}