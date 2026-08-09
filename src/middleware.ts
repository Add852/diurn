import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: [
    // Pages only; API routes self-check auth and return JSON 401.
    "/((?!_next/static|_next/image|favicon.ico|api|login|setup).*)",
  ],
};

export function middleware(req: NextRequest) {
  const cookie = req.cookies.get("diurn_session");
  const path = req.nextUrl.pathname;

  if (!cookie?.value && !path.startsWith("/login") && path !== "/setup") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}