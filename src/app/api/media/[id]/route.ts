import { NextResponse } from "next/server";
import { cachedMedia, fail, getAccount, loadMedia } from "@/lib/api";
import { paths, readJson } from "@/lib/store";
import type { CommentsFile, InsightsFile, TranscriptFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the post page needs, in one round trip. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    // Only reach for a token when the post isn't already on disk.
    const cached = refresh ? null : await cachedMedia(id);
    const media = cached ?? (await loadMedia(await getAccount(), id, refresh));

    const [comments, insights, transcript] = await Promise.all([
      readJson<CommentsFile>(paths.comments(id)),
      readJson<InsightsFile>(paths.insights(id)),
      readJson<TranscriptFile>(paths.transcript(id)),
    ]);

    return NextResponse.json({ media, comments, insights, transcript });
  } catch (err) {
    return fail(err);
  }
}
