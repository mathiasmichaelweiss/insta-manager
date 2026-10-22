import { fail, getAccount, loadMediaIndex } from "@/lib/api";
import { fetchInsights } from "@/lib/instagram";
import { paths, writeJson } from "@/lib/store";
import { streamSync } from "@/lib/sync";
import type { Account, Media } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * Reads insights for every post. Always refetches — metrics keep moving, and a
 * Reel accumulates views for weeks after it is published.
 *
 * Runs one post at a time: `fetchInsights` may fall back to per-metric requests,
 * and Instagram's hourly call budget is small. It remembers metrics this account
 * cannot read, so that fallback costs a lot less after the first few posts.
 */
export async function POST(request: Request) {
  let account: Account;
  let posts: Media[];
  try {
    account = await getAccount();
    // Stories expire after 24 hours and report a different metric set.
    posts = (await loadMediaIndex(account, true)).media.filter(
      (m) => m.media_product_type !== "STORY",
    );
  } catch (err) {
    return fail(err);
  }

  return streamSync(request, posts, async (media) => {
    const file = await fetchInsights(account, media);
    await writeJson(paths.insights(media.id), file);

    const read = Object.keys(file.metrics).length;
    return {
      count: read,
      warning:
        read === 0
          ? "Instagram не отдал ни одной метрики. Обычно это значит, что приложению не " +
            "выдано разрешение instagram_business_manage_insights — добавьте его в " +
            "«Разрешения и функции» и сгенерируйте маркер доступа заново."
          : undefined,
    };
  });
}
