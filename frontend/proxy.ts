import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/admin"] as const;
const GUEST_ONLY_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
] as const;
const PUBLIC_PREFIXES = [
  "/api/",
  "/_next/",
  "/fonts/",
  "/docs",
  "/pricing",
  "/privacy",
  "/terms",
] as const;
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth-session_token",
  "__Secure-better-auth-session_token",
] as const;

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)));
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

function matchesPath(pathname: string, paths: readonly string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/" ||
    matchesPrefix(pathname, PUBLIC_PREFIXES) ||
    pathname === "/verify-email" ||
    pathname.startsWith("/verify-email/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const isAuthenticated = hasSessionCookie(request);

  if (matchesPrefix(pathname, PROTECTED_PREFIXES) && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (matchesPath(pathname, GUEST_ONLY_PATHS) && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-.*|apple-touch-icon|logo\\.svg|robots\\.txt|sitemap\\.xml).*)",
  ],
};
