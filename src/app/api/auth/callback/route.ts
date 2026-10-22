import { NextResponse } from "next/server";
import { resolveAccount, saveAccount } from "@/lib/account";
import { config } from "@/lib/config";
import { graphGet } from "@/lib/graph";
import type { AuthMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(message: string, ok: boolean) {
  const url = new URL("/settings", config.baseUrl);
  url.searchParams.set(ok ? "ok" : "error", message);
  return NextResponse.redirect(url);
}

/** Instagram login: code → 1-hour token → 60-day token. */
async function instagramToken(code: string, redirectUri: string): Promise<string> {
  const form = new URLSearchParams({
    client_id: config.igAppId,
    client_secret: config.igAppSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; error_message?: string; error?: { message?: string } }
    | null;

  const shortLived = body?.access_token;
  if (!res.ok || !shortLived) {
    throw new Error(
      body?.error_message || body?.error?.message || `Обмен кода не удался (HTTP ${res.status})`,
    );
  }

  const long = await graphGet<{ access_token: string }>(
    "access_token",
    { grant_type: "ig_exchange_token", client_secret: config.igAppSecret },
    shortLived,
    "graph.instagram.com",
  );
  return long.access_token;
}

/** Facebook login: code → short-lived token → ~60-day token. */
async function facebookToken(code: string, redirectUri: string): Promise<string> {
  const short = await graphGet<{ access_token: string }>(
    "oauth/access_token",
    {
      client_id: config.fbAppId,
      client_secret: config.fbAppSecret,
      redirect_uri: redirectUri,
      code,
    },
    "",
  );

  const long = await graphGet<{ access_token: string }>(
    "oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: config.fbAppId,
      client_secret: config.fbAppSecret,
      fb_exchange_token: short.access_token,
    },
    "",
  );
  return long.access_token;
}

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error_description");

  if (denied) return back(denied, false);
  if (!code) return back("Авторизация не вернула код", false);

  if (!state || state !== cookieValue(request, "oauth_state")) {
    return back("Не совпал state — повторите вход", false);
  }

  const mode = (cookieValue(request, "oauth_mode") ?? "instagram") as AuthMode;
  const redirectUri = `${config.baseUrl}/api/auth/callback`;

  try {
    const token =
      mode === "instagram"
        ? await instagramToken(code, redirectUri)
        : await facebookToken(code, redirectUri);

    const account = await resolveAccount(token, "oauth", mode);
    await saveAccount(account);

    const res = back(`Подключён аккаунт @${account.username ?? account.igUserId}`, true);
    res.cookies.delete("oauth_state");
    res.cookies.delete("oauth_mode");
    return res;
  } catch (err) {
    return back(err instanceof Error ? err.message : String(err), false);
  }
}
