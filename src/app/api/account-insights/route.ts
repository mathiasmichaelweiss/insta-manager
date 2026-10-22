import { NextResponse } from "next/server";
import { fetchAccountInsights, readAccountInsights } from "@/lib/accountInsights";
import { fail, getAccount } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cached history; `?refresh=1` pulls a fresh 30-day window and merges it in. */
export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (!refresh) {
      const cached = await readAccountInsights();
      if (cached) return NextResponse.json(cached);
    }
    return NextResponse.json(await fetchAccountInsights(await getAccount()));
  } catch (err) {
    return fail(err);
  }
}

export async function POST() {
  try {
    return NextResponse.json(await fetchAccountInsights(await getAccount()));
  } catch (err) {
    return fail(err);
  }
}
