import { NextResponse } from "next/server";
import { peekAccount } from "@/lib/account";
import { fail } from "@/lib/api";
import { listIds, paths, readJson } from "@/lib/store";
import {
  BATCH_SIZE,
  analysisModel,
  estimateUsd,
  runTopicAnalysis,
  splitAnalyzable,
} from "@/lib/topics";
import type { ConversationFile, FlatComment, TopicsFile, TopicsPlan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const DM_TOPICS_PATH = "dm-topics.json";

/**
 * Incoming Direct messages, flattened for the topic engine.
 *
 * Only what the other side wrote — your own replies are not audience questions.
 * Identities are dropped here rather than later: usernames never enter the text
 * sent to OpenAI, only the message bodies do.
 */
async function loadIncoming(igUserId: string): Promise<FlatComment[]> {
  const out: FlatComment[] = [];

  for (const id of await listIds("conversations")) {
    const file = await readJson<ConversationFile>(paths.conversation(id));
    if (!file) continue;

    for (const message of file.messages) {
      if (!message.message || message.from?.id === igUserId) continue;
      out.push({
        commentId: message.id,
        // The engine counts distinct groups; for DMs a group is a conversation.
        mediaId: file.id,
        text: message.message.trim(),
        timestamp: message.created_time,
        isReply: false,
      });
    }
  }
  return out;
}

export async function GET() {
  try {
    const account = await peekAccount();
    if (!account) return NextResponse.json({ error: "Аккаунт не подключён" }, { status: 401 });

    const incoming = await loadIncoming(account.igUserId);
    const { analyzable, reactions } = splitAnalyzable(incoming);
    const existing = await readJson<TopicsFile>(DM_TOPICS_PATH);

    const plan: TopicsPlan = {
      totalComments: incoming.length,
      analyzable: analyzable.length,
      reactionsOnly: reactions.length,
      batches: Math.ceil(analyzable.length / BATCH_SIZE),
      estimatedUsd: estimateUsd(analyzable.length),
      model: analysisModel(),
      existing: existing
        ? { createdAt: existing.createdAt, topics: existing.topics.length }
        : undefined,
    };
    return NextResponse.json(plan);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  try {
    const account = await peekAccount();
    if (!account) return NextResponse.json({ error: "Аккаунт не подключён" }, { status: 401 });

    const incoming = await loadIncoming(account.igUserId);
    const { analyzable, reactions } = splitAnalyzable(incoming);

    if (analyzable.length === 0) {
      return NextResponse.json(
        { error: "Нет входящих сообщений — сначала загрузите диалоги на странице «Директ»." },
        { status: 400 },
      );
    }

    return await runTopicAnalysis({
      request,
      analyzable,
      totalCount: incoming.length,
      reactionsOnly: reactions.length,
      savePath: DM_TOPICS_PATH,
      extra: { source: "direct" },
    });
  } catch (err) {
    return fail(err);
  }
}
