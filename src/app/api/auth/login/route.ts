import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { FB_SCOPES, IG_SCOPES, config } from "@/lib/config";
import type { AuthMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mode = (new URL(request.url).searchParams.get("mode") ?? "instagram") as AuthMode;
  const state = randomBytes(16).toString("hex");
  const redirectUri = `${config.baseUrl}/api/auth/callback`;

  let url: URL;
  if (mode === "instagram") {
    if (!config.igAppId || !config.igAppSecret) {
      return NextResponse.json(
        {
          error:
            "IG_APP_ID / IG_APP_SECRET не заданы. Возьмите «ID приложения Instagram» и «Секрет " +
            "приложения Instagram» из дашборда, либо просто вставьте маркер доступа вручную.",
        },
        { status: 400 },
      );
    }
    url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", config.igAppId);
    url.searchParams.set("scope", IG_SCOPES.join(","));
  } else {
    if (!config.fbAppId || !config.fbAppSecret) {
      return NextResponse.json(
        { error: "FB_APP_ID / FB_APP_SECRET не заданы. Вставьте маркер доступа вручную." },
        { status: 400 },
      );
    }
    url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", config.fbAppId);
    url.searchParams.set("scope", FB_SCOPES.join(","));
  }

  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  const cookie = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  res.cookies.set("oauth_state", state, cookie);
  res.cookies.set("oauth_mode", mode, cookie);
  return res;
}
