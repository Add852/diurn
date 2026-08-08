import { NextResponse } from "next/server";
import { hasUsers } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ needs_setup: !hasUsers() });
}