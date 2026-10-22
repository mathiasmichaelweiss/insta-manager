import { NextResponse } from "next/server";
import { fail, getAccount, loadMedia } from "@/lib/api";
import { fetchInsights } from "@/lib/instagram";
import { paths, readJson, writeJson } from "@/lib/store";
import type { InsightsFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    if (!refresh) {
      const cached = await readJson<InsightsFile>(paths.insights(id));
      if (cached) return NextResponse.json(cached);
    }

    const account = await getAccount();
    // Insight counters move constantly, so always read the post fresh too.
    const media = await loadMedia(account, id, true);
    const insights = await fetchInsights(account, media);
    await writeJson(paths.insights(id), insights);
    return NextResponse.json(insights);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const account = await getAccount();
    const media = await loadMedia(account, id, true);
    const insights = await fetchInsights(account, media);
    await writeJson(paths.insights(id), insights);
    return NextResponse.json(insights);
  } catch (err) {
    return fail(err);
  }
}
