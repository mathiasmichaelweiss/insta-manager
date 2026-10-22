import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { listIds, paths, readJson } from "@/lib/store";
import type { CommentsFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which posts already have data on disk — drives the badges in the table. */
export async function GET() {
  try {
    const [commentIds, insights, transcripts] = await Promise.all([
      listIds("comments"),
      listIds("insights"),
      listIds("transcripts"),
    ]);

    // How many comments each saved file actually holds. The table compares this
    // with the post's comments_count: a file that exists but came back empty is
    // not "loaded", and saying so would hide a permissions problem.
    // Derived from the file contents rather than a stored flag, so files written
    // by older versions of the app are classified correctly too.
    const commentsFetched: Record<string, number> = {};
    await Promise.all(
      commentIds.map(async (id) => {
        const file = await readJson<CommentsFile>(paths.comments(id));
        commentsFetched[id] = file?.totalWithReplies ?? 0;
      }),
    );

    return NextResponse.json({ comments: commentIds, commentsFetched, insights, transcripts });
  } catch (err) {
    return fail(err);
  }
}
