import { NextResponse } from "next/server";
import { cachedMediaIndex, fail, getAccount, loadMediaIndex } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    // Serve the cache without touching Instagram, so an expired token still
    // lets you read and export what was already downloaded.
    if (!refresh) {
      const cached = await cachedMediaIndex();
      if (cached) return NextResponse.json(cached);
    }

    const account = await getAccount();
    return NextResponse.json(await loadMediaIndex(account, refresh));
  } catch (err) {
    return fail(err);
  }
}
