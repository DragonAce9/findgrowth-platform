import { NextRequest, NextResponse } from "next/server";

const PUBLIC = new Set(["/login", "/register"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-fg-path", pathname);
  requestHeaders.set("x-fg-search", request.nextUrl.search);

  if (process.env.FG_EXPORT === "1") {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const session = request.cookies.get("fg_session")?.value;
  const project = request.cookies.get("fg_project")?.value;
  const isPublic = PUBLIC.has(pathname) || pathname === "/logout";

  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (session && !project && pathname !== "/projects" && !pathname.startsWith("/projects/open") && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
