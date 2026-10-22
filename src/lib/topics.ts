import { analysisClient, analysisModel } from "./ai";
import { listIds, paths, readJson, writeJson } from "./store";
import { streamSync } from "./sync";
import type { Account, CommentsFile, Comment, FlatComment, Topic, TopicsFile } from "./types";

/**
 * Groups the comment archive into recurring topics.
 *
 * Two passes, because one is not enough: classifying batch by batch and letting
 * each batch invent its own labels produces forty near-duplicate topics that
 * cannot be counted. So pass one reads a spread-out sample and fixes a
 * taxonomy; pass two assigns every comment to that fixed list.
 */

export const BATCH_SIZE = 80;
/** Comments shorter than this are reactions ("❤️", "👍"), not topics. */
const MIN_MEANINGFUL_LENGTH = 4;
const SAMPLE_SIZE = 600;

/** gpt-4o-mini, USD per 1M tokens. */
const USD_PER_M_INPUT = 0.15;
const USD_PER_M_OUTPUT = 0.6;

export { analysisModel };

const client = analysisClient;

/** Every comment on disk, flattened out of the per-post files. */
export async function loadComments(account?: Account): Promise<FlatComment[]> {
  const out: FlatComment[] = [];
  const own = account?.username?.toLowerCase();

  for (const id of await listIds("comments")) {
    const file = await readJson<CommentsFile>(paths.comments(id));
    if (!file) continue;

    const walk = (list: Comment[], isReply: boolean) => {
      for (const c of list) {
        // The author's own replies are not audience questions.
        if (own && c.username?.toLowerCase() === own) continue;
        out.push({
          commentId: c.id,
          mediaId: file.mediaId,
          text: (c.text ?? "").trim(),
          timestamp: c.timestamp,
          likeCount: c.like_count,
          isReply,
        });
        if (c.replies?.length) walk(c.replies, true);
      }
    };
    walk(file.comments, false);
  }

  return out;
}

/** Strips out pure reactions — they cost tokens and carry no topic. */
export function splitAnalyzable(comments: FlatComment[]) {
  const analyzable: FlatComment[] = [];
  const reactions: FlatComment[] = [];

  for (const c of comments) {
    // Count letters and digits only, so "❤️❤️❤️" lands in reactions.
    const meaningful = c.text.replace(/[^\p{L}\p{N}]/gu, "");
    (meaningful.length >= MIN_MEANINGFUL_LENGTH ? analyzable : reactions).push(c);
  }
  return { analyzable, reactions };
}

export function estimateUsd(analyzable: number): number {
  const batches = Math.ceil(analyzable / BATCH_SIZE);
  // ~30 tokens per comment in, plus the taxonomy repeated in every batch.
  const inputTokens = analyzable * 30 + batches * 600 + SAMPLE_SIZE * 30;
  const outputTokens = analyzable * 12 + 1500;
  const usd =
    (inputTokens / 1_000_000) * USD_PER_M_INPUT + (outputTokens / 1_000_000) * USD_PER_M_OUTPUT;
  return Math.round(usd * 100) / 100;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseJson<T>(raw: string | null | undefined, what: string): T {
  if (!raw) throw new Error(`Модель вернула пустой ответ (${what})`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Не удалось разобрать ответ модели (${what})`);
  }
}

export interface TopicDefinition {
  id: string;
  name: string;
  description: string;
}

/**
 * Pass one. Samples the archive evenly across time rather than taking the first
 * N, so the taxonomy is not skewed towards whichever posts happen to sort first.
 */
export async function buildTaxonomy(analyzable: FlatComment[]): Promise<TopicDefinition[]> {
  const step = Math.max(1, Math.floor(analyzable.length / SAMPLE_SIZE));
  const sample = analyzable.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE);

  const res = await client().chat.completions.create({
    model: analysisModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Ты аналитик аудитории блогера. По выборке комментариев составь список из 12–18 тем.\n\n" +
          "Главное требование — ПОКРЫТИЕ: набор тем должен вмещать не меньше 85% комментариев. " +
          "Проверь себя по выборке: если заметная доля комментариев никуда не попадает, " +
          "добавь тему под них.\n\n" +
          "Большинство комментариев под постами — это не вопросы, а реакции. Поэтому наряду " +
          "с предметными темами («признание диплома», «поиск жилья», «уровень языка») " +
          "обязательно заведи темы под массовые типы реакций, например: согласие и поддержка " +
          "автора, спор и критика, рассказ о личном опыте, обсуждение других стран. " +
          "Без них половина архива окажется в «прочем», и разбор потеряет смысл.\n\n" +
          'Ответь JSON: {"topics":[{"id":"kebab-case-латиницей","name":"Короткое название ' +
          'по-русски","description":"Одно предложение, что сюда попадает"}]}',
      },
      { role: "user", content: sample.map((c) => `- ${c.text.slice(0, 300)}`).join("\n") },
    ],
  });

  const parsed = parseJson<{ topics?: TopicDefinition[] }>(
    res.choices[0]?.message?.content,
    "список тем",
  );
  const topics = (parsed.topics ?? []).filter((t) => t.id && t.name);
  if (topics.length === 0) throw new Error("Модель не вернула ни одной темы");
  return topics;
}

/**
 * Extra topics for whatever the first pass dumped into "other". The classifier
 * is conservative and over-uses that bucket, so a second look at the leftovers
 * usually recovers a large share of the archive.
 */
export async function extendTaxonomy(
  leftovers: FlatComment[],
  existing: TopicDefinition[],
): Promise<TopicDefinition[]> {
  const step = Math.max(1, Math.floor(leftovers.length / SAMPLE_SIZE));
  const sample = leftovers.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE);

  const res = await client().chat.completions.create({
    model: analysisModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Эти комментарии не подошли ни под одну из уже существующих тем. Придумай до 6 " +
          "новых тем, которые их покрывают. Не повторяй и не переименовывай существующие.\n\n" +
          `Существующие темы:\n${existing.map((t) => `${t.id} — ${t.name}`).join("\n")}\n\n` +
          'Ответь JSON: {"topics":[{"id":"kebab-case-латиницей","name":"Название по-русски",' +
          '"description":"Одно предложение"}]}',
      },
      { role: "user", content: sample.map((c) => `- ${c.text.slice(0, 300)}`).join("\n") },
    ],
  });

  const parsed = parseJson<{ topics?: TopicDefinition[] }>(
    res.choices[0]?.message?.content,
    "дополнительные темы",
  );
  const known = new Set(existing.map((t) => t.id));
  return (parsed.topics ?? []).filter((t) => t.id && t.name && !known.has(t.id));
}

/** Pass two. Assigns one batch of comments to the fixed taxonomy. */
export async function classifyBatch(
  batch: FlatComment[],
  taxonomy: TopicDefinition[],
): Promise<Map<string, { topicId: string; isQuestion: boolean }>> {
  const res = await client().chat.completions.create({
    model: analysisModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Отнеси каждый комментарий ровно к одной теме из списка. Выбирай ближайшую по смыслу; " +
          '"other" — только если ни одна тема не подходит даже отдалённо. Отдельно пометь, ' +
          "содержит ли комментарий вопрос к автору.\n\n" +
          `Темы:\n${taxonomy.map((t) => `${t.id} — ${t.name}: ${t.description}`).join("\n")}\n\n` +
          'Ответь JSON: {"items":[{"i":номер,"topic":"id-темы","question":true|false}]}. ' +
          "Верни ровно столько элементов, сколько получил комментариев.",
      },
      {
        role: "user",
        content: batch.map((c, i) => `${i}. ${c.text.slice(0, 400)}`).join("\n"),
      },
    ],
  });

  const parsed = parseJson<{ items?: { i: number; topic: string; question?: boolean }[] }>(
    res.choices[0]?.message?.content,
    "классификация",
  );

  const known = new Set(taxonomy.map((t) => t.id));
  const result = new Map<string, { topicId: string; isQuestion: boolean }>();
  for (const item of parsed.items ?? []) {
    const comment = batch[item.i];
    if (!comment) continue;
    result.set(comment.commentId, {
      topicId: known.has(item.topic) ? item.topic : "other",
      isQuestion: Boolean(item.question),
    });
  }
  return result;
}

/**
 * The whole classification run as one streaming response: fixed taxonomy, then
 * batch classification, then a second pass over whatever landed in "other".
 *
 * Shared by comment analysis and Direct-message analysis — the two differ only
 * in where the texts come from.
 */
export async function runTopicAnalysis(options: {
  request: Request;
  analyzable: FlatComment[];
  totalCount: number;
  reactionsOnly: number;
  savePath: string;
  extra?: Record<string, unknown>;
}): Promise<Response> {
  const { request, analyzable, totalCount, reactionsOnly, savePath, extra } = options;

  let taxonomy = await buildTaxonomy(analyzable);
  const batches = chunk(analyzable, BATCH_SIZE).map((items, i) => ({ id: `batch-${i}`, items }));

  const assignments = new Map<string, { topicId: string; isQuestion: boolean }>();
  const processed: FlatComment[] = [];
  const isRefinement = new Set<string>();

  // Batches run in parallel but all write the same file. Chaining the writes
  // keeps them ordered, so a slow early save can't overwrite a later, fuller one.
  let pendingWrite: Promise<void> = Promise.resolve();
  const save = () => {
    const snapshot: TopicsFile = {
      createdAt: new Date().toISOString(),
      model: analysisModel(),
      totalComments: totalCount,
      analyzed: processed.length,
      reactionsOnly,
      topics: aggregate(taxonomy, [...processed], new Map(assignments)),
      ...extra,
    };
    pendingWrite = pendingWrite.then(() => writeJson(savePath, snapshot));
    return pendingWrite;
  };

  return streamSync(
    request,
    batches,
    async (batch) => {
      let result: Awaited<ReturnType<typeof classifyBatch>>;
      try {
        result = await classifyBatch(batch.items, taxonomy);
      } catch {
        // One malformed response shouldn't cost a whole batch — try once more.
        result = await classifyBatch(batch.items, taxonomy);
      }

      for (const [itemId, assignment] of result) assignments.set(itemId, assignment);
      if (!isRefinement.has(batch.id)) processed.push(...batch.items);
      await save();
      return { count: result.size };
    },
    4,
    // The classifier over-uses "other"; give the leftovers their own topics and
    // look again. Without this pass roughly half the archive ends up unlabelled.
    async () => {
      const leftovers = processed.filter(
        (c) => (assignments.get(c.commentId)?.topicId ?? "other") === "other",
      );
      if (leftovers.length < processed.length * 0.15) return [];

      const additions = await extendTaxonomy(leftovers, taxonomy);
      if (additions.length === 0) return [];
      taxonomy = [...taxonomy, ...additions];

      return chunk(leftovers, BATCH_SIZE).map((items, i) => {
        const id = `refine-${i}`;
        isRefinement.add(id);
        return { id, items };
      });
    },
    1,
  );
}

/** Folds per-comment assignments into the topic list shown in the UI. */
export function aggregate(
  taxonomy: TopicDefinition[],
  comments: FlatComment[],
  assignments: Map<string, { topicId: string; isQuestion: boolean }>,
): Topic[] {
  const definitions = [
    ...taxonomy,
    { id: "other", name: "Прочее", description: "Не подошло ни под одну тему" },
  ];

  const buckets = new Map<string, { items: FlatComment[]; questions: number }>();

  for (const comment of comments) {
    // Models occasionally return fewer items than they were given. Anything
    // unaccounted for goes to "other" rather than silently vanishing, so the
    // topic counts always add up to what was actually sent.
    const assignment = assignments.get(comment.commentId);
    const topicId = assignment?.topicId ?? "other";
    const bucket = buckets.get(topicId) ?? { items: [], questions: 0 };
    bucket.items.push(comment);
    if (assignment?.isQuestion) bucket.questions += 1;
    buckets.set(topicId, bucket);
  }

  return definitions
    .map((definition): Topic => {
      const bucket = buckets.get(definition.id) ?? { items: [], questions: 0 };
      // Show the most-liked examples: those are the ones the audience seconded.
      const examples = [...bucket.items]
        .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
        .slice(0, 5)
        .map((c) => ({ text: c.text, mediaId: c.mediaId, commentId: c.commentId }));

      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        count: bucket.items.length,
        questionCount: bucket.questions,
        postCount: new Set(bucket.items.map((c) => c.mediaId)).size,
        examples,
      };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}
