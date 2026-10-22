import { NextResponse } from "next/server";
import { getAccount, publicAccount, refreshInstagramToken } from "@/lib/account";
import { fail } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resets the 60-day clock on an Instagram long-lived token. */
export async function POST() {
  try {
    const account = await refreshInstagramToken(await getAccount());
    return NextResponse.json({ account: publicAccount(account) });
  } catch (err) {
    return fail(err);
  }
}
