import { NextResponse } from "next/server";
import { peekAccount } from "@/lib/account";
import { fail } from "@/lib/api";
import { loadConversations } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conversation list built from what is on disk — no API calls. */
export async function GET() {
  try {
    const account = await peekAccount();
    if (!account) return NextResponse.json({ conversations: [], igUserId: null });

    const conversations = await loadConversations(account.igUserId);
    return NextResponse.json({
      igUserId: account.igUserId,
      total: conversations.length,
      awaitingReply: conversations.filter((c) => c.needsReply).length,
      conversations,
    });
  } catch (err) {
    return fail(err);
  }
}
