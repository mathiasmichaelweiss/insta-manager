import { NextResponse } from "next/server";
import {
  clearAccount,
  peekAccount,
  publicAccount,
  resolveAccount,
  saveAccount,
} from "@/lib/account";
import { fail } from "@/lib/api";
import { config } from "@/lib/config";
import type { AuthMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await peekAccount();
    return NextResponse.json({
      account: publicAccount(account),
      igOauthAvailable: Boolean(config.igAppId && config.igAppSecret),
      fbOauthAvailable: Boolean(config.fbAppId && config.fbAppSecret),
      openaiConfigured: Boolean(config.openaiKey),
      graphVersion: config.graphVersion,
      envTokenPresent: Boolean(config.envToken),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { accessToken?: string; mode?: AuthMode };
    const token = body.accessToken?.trim();
    if (!token) {
      return NextResponse.json({ error: "Не передан маркер доступа" }, { status: 400 });
    }

    const mode = body.mode === "instagram" || body.mode === "facebook" ? body.mode : undefined;
    const account = await resolveAccount(token, "manual", mode);
    await saveAccount(account);
    return NextResponse.json({ account: publicAccount(account) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE() {
  try {
    await clearAccount();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
