import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "keryx_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if (hasSession && ["/login", "/register"].includes(pathname)) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  if (!hasSession && (pathname === "/" || pathname.startsWith("/admin"))) {
    const redirectUrl = encodeURIComponent(pathname);
    return NextResponse.redirect(
      new URL(`${base}/login?redirect=${redirectUrl}`, request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/admin/:path*",
    "/login",
    "/register",
    "/invite/:path*",
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
