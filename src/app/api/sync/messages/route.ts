import { fail, getAccount } from "@/lib/api";
import { fetchConversations, syncConversation } from "@/lib/messages";
import { streamSync } from "@/lib/sync";
import type { Account } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * Pulls every Direct thread. Incremental by default: a thread is only refetched
 * when Instagram's `updated_time` moved, which keeps a daily run affordable
 * against the hourly call budget. `?full=1` forces a complete re-read.
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("full") === "1";
  // Deep pass pulls entire threads; it will hit the hourly budget and resume later.
  const deep = params.get("deep") === "1";

  let account: Account;
  let conversations: Awaited<ReturnType<typeof fetchConversations>>;
  try {
    account = await getAccount();
    conversations = await fetchConversations(account);
  } catch (err) {
    return fail(err);
  }

  return streamSync(request, conversations, async (conversation) => {
    const { file, skipped } = await syncConversation(account, conversation, force, deep);
    return { count: skipped ? 0 : file.messageCount, skipped };
  });
}
