import { peekAccount } from "./account";
import { readAccountInsights, sumRecent } from "./accountInsights";
import { loadMetrics, median } from "./metrics";
import { listIds, paths, readJson } from "./store";
import type {
  Brief,
  BriefPost,
  CommentsFile,
  ConversationFile,
  Draft,
  MediaIndex,
  TopicsFile,
  TranscriptFile,
} from "./types";

/** Speech from the opening seconds — the part that decides whether anyone stays. */
export const HOOK_SECONDS = 5;

export function hookOf(transcript?: {
  segments?: { start: number; text: string }[];
  text?: string;
}): string | undefined {
  if (!transcript) return undefined;
  const segments = transcript.segments ?? [];
  if (segments.length === 0) return transcript.text?.slice(0, 160);

  const opening = segments.filter((s) => s.start < HOOK_SECONDS).map((s) => s.text);
  // A single long segment can swallow the whole clip; fall back to the first one.
  return (opening.length ? opening : [segments[0].text]).join(" ").trim();
}

/**
 * Bundles the whole archive into one object for an outside AI agent: how each
 * published post performed, what was actually said in it, what the audience
 * keeps asking about, and — optionally — the draft under consideration.
 *
 * Sorted best-first by reach so the agent reads the winners before the rest.
 */
export async function buildBrief(draftId?: string, includeDms = true): Promise<Brief> {
  const [account, index, metrics, topics, followers] = await Promise.all([
    peekAccount(),
    readJson<MediaIndex>(paths.media),
    loadMetrics(),
    readJson<TopicsFile>(paths.topics),
    readAccountInsights(),
  ]);

  // Direct messages ride along by default; pass includeDms=false (?dm=0) to
  // hand an agent a brief with nothing private in it.
  const threads = includeDms ? await loadThreads() : [];
  const dmTopics = includeDms ? await readJson<TopicsFile>("dm-topics.json") : null;

  const byId = new Map(metrics.rows.map((row) => [row.mediaId, row]));
  const media = index?.media ?? [];

  const posts: BriefPost[] = [];
  for (const item of media) {
    const row = byId.get(item.id);
    const transcript = await readJson<TranscriptFile>(paths.transcript(item.id));
    const comments = await readJson<CommentsFile>(paths.comments(item.id));

    posts.push({
      id: item.id,
      permalink: item.permalink,
      publishedAt: item.timestamp,
      productType: item.media_product_type,
      mediaType: item.media_type,
      // Without this a 20-slide carousel and a Reel look alike to an agent, and
      // it compares formats that have nothing in common.
      slides: item.children?.data?.length || undefined,
      caption: item.caption,
      reach: row?.reach,
      views: row?.views,
      retention: row?.retention,
      skipRate: row?.skipRate,
      er: row?.er,
      savedPerReach: row?.savedPerReach,
      sharesPerReach: row?.sharesPerReach,
      comments: comments?.totalWithReplies ?? item.comments_count,
      hook: hookOf(transcript ?? undefined),
      transcript: transcript?.text || undefined,
    });
  }

  posts.sort((a, b) => (b.reach ?? -1) - (a.reach ?? -1));

  const draft = draftId ? await readJson<Draft>(paths.draft(draftId)) : null;

  return {
    generatedAt: new Date().toISOString(),
    account: {
      username: account?.username,
      followers: account?.followersCount,
      publishedPosts: media.length,
      newFollowers30d: followers ? sumRecent(followers.followerCount, 30) : undefined,
      newFollowers7d: followers ? sumRecent(followers.followerCount, 7) : undefined,
    },
    // Without these an agent will read the numbers too literally: it would treat
    // a missing metric as a zero and rank Reels against feed posts on stats the
    // two formats do not share.
    dataNotes: [
      "Подписки нельзя приписать конкретному Reels: Instagram не отдаёт метрику follows для " +
        "этого формата, поэтому в постах её нет. Пользуйтесь newFollowers30d/7d по аккаунту.",
      "profile_visits и profile_activity Instagram тоже отдаёт только для постов ленты и Stories.",
      "retention (досмотр) есть только у роликов с транскриптом — длительность берётся оттуда, " +
        "Instagram её не сообщает.",
      "Отсутствующее поле означает «метрики не существует», а не ноль.",
      ...(includeDms
        ? [
            "directMessages содержит личную переписку с конкретными людьми. Не цитируй её " +
              "публично и не приписывай высказывания именам.",
          ]
        : []),
    ],
    benchmarks: {
      medianReach: metrics.medianReach,
      medianRetention: metrics.medianRetention,
      medianEr: median(
        metrics.rows.map((r) => r.er).filter((v): v is number => v !== undefined),
      ),
      medianSavedPerReach: median(
        metrics.rows.map((r) => r.savedPerReach).filter((v): v is number => v !== undefined),
      ),
    },
    posts,
    commentTopics: (topics?.topics ?? [])
      // "Прочее" is a leftovers bin, not a topic — it would only add noise.
      .filter((topic) => topic.id !== "other")
      .map((topic) => ({
        name: topic.name,
        description: topic.description,
        count: topic.count,
        questionCount: topic.questionCount,
        postCount: topic.postCount,
        examples: topic.examples.map((e) => e.text),
      })),
    // Included at your explicit request. This is private correspondence with
    // named people, and it leaves your machine the moment the brief does.
    directMessages: includeDms
      ? {
          conversations: threads.length,
          messages: threads.reduce((sum, t) => sum + t.messageCount, 0),
          topics: (dmTopics?.topics ?? [])
            .filter((topic) => topic.id !== "other")
            .map((topic) => ({
              name: topic.name,
              description: topic.description,
              count: topic.count,
              questionCount: topic.questionCount,
              conversationCount: topic.postCount,
              examples: topic.examples.map((e) => e.text),
            })),
          threads: threads.map((thread) => ({
            id: thread.id,
            counterpart: thread.counterpart?.username,
            messages: thread.messages
              .filter((m) => m.message)
              .map((m) => ({
                at: m.created_time,
                mine: m.from?.id === account?.igUserId,
                text: m.message,
              })),
          })),
        }
      : undefined,
    draft: draft
      ? {
          title: draft.title,
          duration: draft.duration,
          hook: hookOf(draft) ?? "",
          transcript: draft.text,
        }
      : undefined,
  };
}

async function loadThreads(): Promise<ConversationFile[]> {
  const threads: ConversationFile[] = [];
  for (const id of await listIds("conversations")) {
    const file = await readJson<ConversationFile>(paths.conversation(id));
    if (file) threads.push(file);
  }
  return threads;
}

export async function listDrafts(): Promise<Draft[]> {
  const drafts: Draft[] = [];
  for (const id of await listIds("drafts")) {
    const draft = await readJson<Draft>(paths.draft(id));
    if (draft) drafts.push(draft);
  }
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
