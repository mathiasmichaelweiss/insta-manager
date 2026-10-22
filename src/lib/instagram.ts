import { hostFor } from "./account";
import type { ApiHost } from "./config";
import { GraphError, graphGet, graphGetAll, mapLimit } from "./graph";
import type {
  Account,
  Comment,
  CommentsFile,
  InsightsFile,
  Media,
  MediaIndex,
  MediaProductType,
  MetricValue,
} from "./types";

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_product_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "username",
  "like_count",
  "comments_count",
  "is_comment_enabled",
  "is_shared_to_feed",
  "children{id,media_type,media_url,thumbnail_url,permalink}",
];

const COMMENT_FIELDS = ["id", "text", "username", "timestamp", "like_count", "hidden"];
const REPLY_FIELDS = [...COMMENT_FIELDS, "parent_id"];
const NESTED_REPLY_LIMIT = 50;

/**
 * Graph rejects the whole request if a single field is unknown to the current
 * API version. Rather than pin a field list per version, drop the field Meta
 * names in the error and retry.
 */
function unknownField(err: unknown): string | null {
  if (!(err instanceof GraphError) || err.code !== 100) return null;
  const match = /nonexistent field \(([^)]+)\)/i.exec(err.message);
  return match ? match[1] : null;
}

async function withFieldFallback<T>(
  fields: string[],
  run: (fields: string[]) => Promise<T>,
): Promise<{ result: T; dropped: string[] }> {
  let current = [...fields];
  const dropped: string[] = [];

  for (;;) {
    try {
      return { result: await run(current), dropped };
    } catch (err) {
      const bad = unknownField(err);
      // Only retry while we are actually making progress.
      const next = bad
        ? current.filter((f) => f !== bad && !f.startsWith(`${bad}{`) && !f.startsWith(`${bad}.`))
        : current;
      if (!bad || next.length === current.length || next.length === 0) throw err;
      dropped.push(bad);
      current = next;
    }
  }
}

export async function fetchMedia(account: Account, maxItems = 5000): Promise<MediaIndex> {
  const host = hostFor(account);
  const { result: media } = await withFieldFallback(MEDIA_FIELDS, (fields) =>
    graphGetAll<Media>(
      `${account.igUserId}/media`,
      { fields: fields.join(","), limit: 50 },
      account.accessToken,
      host,
      maxItems,
    ),
  );

  media.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  return {
    igUserId: account.igUserId,
    username: account.username,
    fetchedAt: new Date().toISOString(),
    count: media.length,
    media,
  };
}

export async function fetchOneMedia(account: Account, mediaId: string): Promise<Media> {
  const { result } = await withFieldFallback(MEDIA_FIELDS, (fields) =>
    graphGet<Media>(mediaId, { fields: fields.join(",") }, account.accessToken, hostFor(account)),
  );
  return result;
}

/** Graph wraps nested edges in `{ data: [...] }`; our stored shape is a plain array. */
interface RawComment extends Omit<Comment, "replies"> {
  replies?: { data: Comment[] } | Comment[];
}

export async function fetchComments(account: Account, media: Media): Promise<CommentsFile> {
  const host = hostFor(account);
  const fields = [
    ...COMMENT_FIELDS,
    `replies.limit(${NESTED_REPLY_LIMIT}){${REPLY_FIELDS.join(",")}}`,
  ];

  const { result: raw } = await withFieldFallback(fields, (f) =>
    graphGetAll<RawComment>(
      `${media.id}/comments`,
      { fields: f.join(","), limit: 50 },
      account.accessToken,
      host,
    ),
  );

  const comments = await mapLimit(raw, 4, async (item): Promise<Comment> => {
    const nested = Array.isArray(item.replies) ? item.replies : (item.replies?.data ?? []);
    // A full nested page means Meta probably truncated it — refetch with paging.
    const replies =
      nested.length >= NESTED_REPLY_LIMIT
        ? await graphGetAll<Comment>(
            `${item.id}/replies`,
            { fields: REPLY_FIELDS.join(","), limit: 50 },
            account.accessToken,
            host,
          )
        : nested;

    return {
      id: item.id,
      text: item.text ?? "",
      username: item.username,
      timestamp: item.timestamp,
      like_count: item.like_count,
      hidden: item.hidden,
      replies: replies.length ? replies : undefined,
    };
  });

  comments.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  const totalWithReplies = comments.reduce((sum, c) => sum + 1 + (c.replies?.length ?? 0), 0);

  return {
    mediaId: media.id,
    permalink: media.permalink,
    fetchedAt: new Date().toISOString(),
    count: comments.length,
    totalWithReplies,
    expected: media.comments_count,
    warning: redactionWarning(media.comments_count, totalWithReplies),
    comments,
  };
}

/**
 * Instagram does not error when it will not hand over comments — it pages
 * through the right number of them and strips every one. Silence would read as
 * "no comments", so name what actually happened.
 *
 * The usual cause is the app still being in Development mode: posts and
 * insights are the owner's own data and come through fine, while comments were
 * written by other people and get withheld.
 */
function redactionWarning(expected: number | undefined, got: number): string | undefined {
  if (!expected || got > 0) return undefined;
  return (
    `Instagram сообщает, что у поста ${expected} комментариев, но вернул 0. ` +
    "Пагинация их видит, содержимое вырезано.\n\n" +
    "Обычная причина — приложение в режиме разработки (Development). В нём API отдаёт " +
    "только ваши собственные данные: посты и статистика работают, а комментарии написаны " +
    "другими людьми и потому скрываются.\n\n" +
    "Что сделать: в дашборде «Настройки → Основное» указать URL политики " +
    "конфиденциальности, затем переключить приложение в режим Live.\n\n" +
    "Режим Live не публикует приложение и не требует App Review. При уровне Standard Access " +
    "им по-прежнему можете пользоваться только вы, и оно продолжит работать на localhost.\n\n" +
    "Если приложение уже Live — проверьте, что instagram_business_manage_comments выдан " +
    "в «Разрешениях и функциях», и сгенерируйте маркер доступа заново."
  );
}

const SHARED_METRICS = [
  "reach",
  "views",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
];

/**
 * Metric sets per Meta's media-insights reference. Meta revises these without
 * bumping the API version, so treat the lists as a best guess and let the
 * per-metric fallback below sort out what this account can actually read.
 */
function metricsFor(media: Media): string[] {
  switch (media.media_product_type) {
    case "STORY":
      return [
        "reach",
        "views",
        "replies",
        "shares",
        "total_interactions",
        "follows",
        "profile_visits",
        "profile_activity",
        "navigation",
        "link_clicks",
      ];
    case "REELS":
      return [
        ...SHARED_METRICS,
        "ig_reels_avg_watch_time",
        "ig_reels_video_view_total_time",
        "reels_skip_rate",
      ];
    default:
      return [...SHARED_METRICS, "profile_visits", "profile_activity", "follows"];
  }
}

/**
 * Metrics Meta refuses for a whole media product type, no matter the account.
 *
 * These are recorded in the saved file instead of being silently absent. A
 * missing `follows` on a Reel is not a zero and not a collection failure — it is
 * a number that does not exist. Leaving it out entirely invites summing the
 * remaining posts and believing the total.
 */
const UNSUPPORTED: Partial<Record<MediaProductType, { metric: string; reason: string }[]>> = {
  REELS: [
    {
      metric: "follows",
      reason:
        "Instagram не отдаёт follows для Reels: «The Media Insights API does not support the " +
        "follows metric for this media product type». Подписки с Reels невозможно приписать " +
        "конкретному ролику — смотрите прирост по аккаунту целиком.",
    },
    {
      metric: "profile_visits",
      reason: "Instagram не отдаёт profile_visits для Reels — метрика существует только для ленты и Stories.",
    },
    {
      metric: "profile_activity",
      reason: "Instagram не отдаёт profile_activity для Reels — метрика существует только для ленты и Stories.",
    },
  ],
};

function unsupportedFor(media: Media): { metric: string; error: string }[] {
  return (UNSUPPORTED[media.media_product_type ?? "FEED"] ?? []).map((entry) => ({
    metric: entry.metric,
    error: entry.reason,
  }));
}

/**
 * Metrics this account cannot read, remembered per media product type so a bulk
 * run does not re-discover the same rejection on every single post.
 */
const rejected = new Map<string, Map<string, string>>();

function rejectionsFor(media: Media): Map<string, string> {
  const key = media.media_product_type ?? "FEED";
  let entry = rejected.get(key);
  if (!entry) {
    entry = new Map();
    rejected.set(key, entry);
  }
  return entry;
}

interface InsightRow {
  name: string;
  title?: string;
  description?: string;
  values?: { value: number }[];
}

function collect(rows: InsightRow[], into: Record<string, MetricValue>) {
  for (const row of rows) {
    into[row.name] = {
      value: row.values?.[0]?.value ?? 0,
      title: row.title,
      description: row.description,
    };
  }
}

async function readMetrics(
  mediaId: string,
  metric: string,
  token: string,
  host: ApiHost,
): Promise<InsightRow[]> {
  const res = await graphGet<{ data: InsightRow[] }>(`${mediaId}/insights`, { metric }, token, host);
  return res.data ?? [];
}

export async function fetchInsights(account: Account, media: Media): Promise<InsightsFile> {
  const host = hostFor(account);
  const memo = rejectionsFor(media);
  const wanted = metricsFor(media).filter((m) => !memo.has(m));

  const metrics: Record<string, MetricValue> = {};
  // Start from what this media type structurally cannot report, so the gap is
  // recorded rather than looking like a metric that happened to come back empty.
  const unavailable: { metric: string; error: string }[] = unsupportedFor(media);

  if (wanted.length) {
    try {
      collect(await readMetrics(media.id, wanted.join(","), account.accessToken, host), metrics);
    } catch (batchError) {
      // A missing permission fails every metric, so don't waste N calls proving it.
      if (batchError instanceof GraphError && (batchError.code === 10 || batchError.code === 200)) {
        throw batchError;
      }

      type Attempt = { metric: string; rows?: InsightRow[]; error?: string };
      const results = await mapLimit(wanted, 4, async (metric): Promise<Attempt> => {
        try {
          return { metric, rows: await readMetrics(media.id, metric, account.accessToken, host) };
        } catch (err) {
          return { metric, error: err instanceof Error ? err.message : String(err) };
        }
      });

      for (const r of results) {
        if (r.rows) collect(r.rows, metrics);
        else {
          const message = r.error ?? "неизвестная ошибка";
          memo.set(r.metric, message);
          unavailable.push({ metric: r.metric, error: message });
        }
      }
    }
  }

  // Surface previously-learned rejections too, so the UI stays honest about
  // what was asked for and what came back.
  for (const [metric, error] of memo) {
    if (!unavailable.some((u) => u.metric === metric)) unavailable.push({ metric, error });
  }

  return {
    mediaId: media.id,
    mediaType: media.media_type,
    mediaProductType: media.media_product_type,
    permalink: media.permalink,
    fetchedAt: new Date().toISOString(),
    counts: { like_count: media.like_count, comments_count: media.comments_count },
    metrics,
    unavailable,
  };
}
