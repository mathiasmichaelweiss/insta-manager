import { NextResponse } from "next/server";
import { fail, getAccount, loadMedia } from "@/lib/api";
import { fetchComments } from "@/lib/instagram";
import { paths, readJson, writeJson } from "@/lib/store";
import type { CommentsFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cached copy, or a fresh pull with ?refresh=1. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    if (!refresh) {
      const cached = await readJson<CommentsFile>(paths.comments(id));
      if (cached) return NextResponse.json(cached);
    }

    const account = await getAccount();
    const media = await loadMedia(account, id);
    const comments = await fetchComments(account, media);
    await writeJson(paths.comments(id), comments);
    return NextResponse.json(comments);
  } catch (err) {
    return fail(err);
  }
}

/** Always hits Instagram. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const account = await getAccount();
    const media = await loadMedia(account, id);
    const comments = await fetchComments(account, media);
    await writeJson(paths.comments(id), comments);
    return NextResponse.json(comments);
  } catch (err) {
    return fail(err);
  }
}
