import { fail, getAccount, loadMediaIndex } from "@/lib/api";
import { fetchComments } from "@/lib/instagram";
import { paths, writeJson } from "@/lib/store";
import { streamSync } from "@/lib/sync";
import type { Account, Media } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Pulls comments for every post that has any, streaming NDJSON progress. */
export async function POST(request: Request) {
  const skipEmpty = new URL(request.url).searchParams.get("skipEmpty") !== "0";

  let account: Account;
  let posts: Media[];
  try {
    account = await getAccount();
    const index = await loadMediaIndex(account, true);
    posts = skipEmpty ? index.media.filter((m) => (m.comments_count ?? 0) > 0) : index.media;
  } catch (err) {
    return fail(err);
  }

  return streamSync(request, posts, async (media) => {
    const file = await fetchComments(account, media);
    await writeJson(paths.comments(media.id), file);
    return { count: file.totalWithReplies, warning: file.warning };
  });
}
