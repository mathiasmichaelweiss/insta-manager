import { NextResponse } from "next/server";
import { peekAccount } from "@/lib/account";
import { fail } from "@/lib/api";
import { paths, readJson } from "@/lib/store";
import {
  BATCH_SIZE,
  analysisModel,
  estimateUsd,
  loadComments,
  runTopicAnalysis,
  splitAnalyzable,
} from "@/lib/topics";
import type { TopicsFile, TopicsPlan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Preflight: how much of the archive would be sent and what it would cost. */
export async function GET() {
  try {
    const comments = await loadComments((await peekAccount()) ?? undefined);
    const { analyzable, reactions } = splitAnalyzable(comments);
    const existing = await readJson<TopicsFile>(paths.topics);

    const plan: TopicsPlan = {
      totalComments: comments.length,
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
    const comments = await loadComments((await peekAccount()) ?? undefined);
    const { analyzable, reactions } = splitAnalyzable(comments);

    if (analyzable.length === 0) {
      return NextResponse.json(
        { error: "Нет комментариев для анализа — сначала загрузите их на странице «Все посты»." },
        { status: 400 },
      );
    }

    return await runTopicAnalysis({
      request,
      analyzable,
      totalCount: comments.length,
      reactionsOnly: reactions.length,
      savePath: paths.topics,
    });
  } catch (err) {
    return fail(err);
  }
}
