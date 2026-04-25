import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const IDENTITY_PATH = "/onboarding/identity";

const AUTH_ROUTES = ["/login", "/register", "/join"];
const PROTECTED_PREFIXES = [
  "/onboarding",
  "/matches",
  "/meet",
  "/meetings",
  "/profile",
  "/schedule",
  "/selection",
  "/invitations",
];

export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;
  const { pathname } = nextUrl;

  const isLoggedIn = !!session;
  const hasToken = !!(session as any)?.accessToken;

  // Redirect unauthenticated users away from protected routes
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  // Redirect authenticated users away from auth pages (except /join — landing page is always accessible)
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r) && !pathname.startsWith("/join"));
  if (isAuthRoute && isLoggedIn && hasToken) {
    return NextResponse.redirect(new URL("/matches", nextUrl));
  }

  // Gender gate — redirect to identity step if gender not yet set.
  // Skip the identity page itself to avoid infinite redirect.
  if (isProtected && pathname !== IDENTITY_PATH && isLoggedIn) {
    const gender = (session as any)?.gender;
    if (!gender) {
      return NextResponse.redirect(new URL(IDENTITY_PATH, nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
