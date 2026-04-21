import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session;
  const accessToken = (session as any)?.accessToken;
  console.log("[DEBUG] Middleware:", { pathname: nextUrl.pathname, isLoggedIn, hasAccessToken: !!accessToken });

  const isAuthRoute = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");
  const isProtectedRoute =
    nextUrl.pathname.startsWith("/onboarding") ||
    nextUrl.pathname.startsWith("/matches") ||
    nextUrl.pathname.startsWith("/profile");

  if (isProtectedRoute && !isLoggedIn) {
    console.log("[DEBUG] Middleware: redirecting to /login (not authenticated)");
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (isAuthRoute && isLoggedIn) {
    console.log("[DEBUG] Middleware: redirecting to /matches (already authenticated)");
    return NextResponse.redirect(new URL("/matches", nextUrl));
  }

  console.log("[DEBUG] Middleware: allowing request");
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
