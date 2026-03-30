import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  getMcSessionCookieName,
  getMcSessionCookieOptions,
  isRequestSecure,
} from "@/lib/session-cookie";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const db = getDatabase();
    const user = db
      .prepare(
        `
      SELECT u.id, u.username, u.display_name, u.role, u.workspace_id
      FROM users u
      WHERE u.role = 'admin'
      ORDER BY u.id ASC
      LIMIT 1
    `,
      )
      .get() as
      | {
          id: number;
          username: string;
          display_name: string;
          role: string;
          workspace_id: number;
        }
      | undefined;

    if (!user) {
      return NextResponse.json(
        { error: "No admin user found. Visit /setup first." },
        { status: 404 },
      );
    }

    const ipAddress = request.headers.get("x-forwarded-for") || "dev";
    const userAgent = request.headers.get("user-agent") || undefined;
    const { token, expiresAt } = createSession(
      user.id,
      ipAddress,
      userAgent,
      user.workspace_id,
    );

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
    });

    const isSecureRequest = isRequestSecure(request);
    const cookieName = getMcSessionCookieName(isSecureRequest);
    response.cookies.set(cookieName, token, {
      ...getMcSessionCookieOptions({
        maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000),
        isSecureRequest,
      }),
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
