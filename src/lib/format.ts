import type { DmAttachment } from "./types";

/** Client-safe formatting helpers — no node imports here. */

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(value?: number | null): string {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString("ru-RU");
}

/** Ratios are stored as fractions; show them as percentages. */
export function formatPercent(value?: number, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return "—";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Aggregate watch time runs to hundreds of hours, where "27938:08" says nothing.
 * Falls back to m:ss only while the value is still short enough to read that way.
 */
export function formatSpan(seconds?: number): string {
  if (seconds === undefined || seconds === null) return "—";
  const total = Math.round(seconds);
  if (total < 3600) return formatDuration(total);

  const hours = Math.floor(total / 3600);
  const mins = Math.round((total % 3600) / 60);
  if (hours < 24) return `${hours} ч ${mins} м`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

export function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Human labels for the raw metric names Meta returns. */
const METRIC_LABELS: Record<string, string> = {
  reach: "Охват",
  views: "Просмотры",
  likes: "Лайки",
  comments: "Комментарии",
  shares: "Репосты",
  saved: "Сохранения",
  replies: "Ответы",
  total_interactions: "Всего взаимодействий",
  profile_visits: "Переходы в профиль",
  profile_activity: "Действия в профиле",
  follows: "Новые подписки",
  navigation: "Навигация",
  link_clicks: "Клики по ссылке",
  reposts: "Репосты в ленту",
  crossposted_views: "Просмотры на Facebook",
  facebook_views: "Просмотры на Facebook",
  impressions: "Показы",
  reels_skip_rate: "Доля пропусков",
  ig_reels_avg_watch_time: "Ср. время просмотра (мс)",
  ig_reels_video_view_total_time: "Общее время просмотра (мс)",
};

export const metricLabel = (name: string) => METRIC_LABELS[name] ?? name;

export const MEDIA_TYPE_LABELS: Record<string, string> = {
  IMAGE: "Фото",
  VIDEO: "Видео",
  CAROUSEL_ALBUM: "Карусель",
};

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  FEED: "Лента",
  REELS: "Reels",
  STORY: "Stories",
  AD: "Реклама",
};

/** Chip colour per publishing surface, so Reels/Stories read at a glance. */
export function productTagClass(productType?: string): string {
  switch (productType) {
    case "REELS":
      return "tag tag--blue";
    case "STORY":
      return "tag tag--lilac";
    case "AD":
      return "tag tag--amber";
    default:
      return "tag";
  }
}

export function isVideoMedia(mediaType?: string, productType?: string): boolean {
  return mediaType === "VIDEO" || productType === "REELS";
}

export type MessageKind = "text" | "template" | "image" | "video" | "unsupported" | "reaction";

/**
 * What a Direct message actually is when `message` is empty.
 *
 * A third of this archive has no text, and calling all of it "пусто" hides real
 * content: automation sends its wording inside `generic_template.title`, photos
 * and videos carry a URL, and only the remainder is a story reaction Instagram
 * will not describe. Saying which is which keeps the thread honest.
 */
export function describeMessage(message: {
  message?: string;
  is_unsupported?: boolean;
  attachments?: { data?: DmAttachment[] };
}): { kind: MessageKind; text: string; url?: string } {
  const text = message.message?.trim();
  if (text) return { kind: "text", text };

  const parts = message.attachments?.data ?? [];

  const template = parts.find((p) => p.generic_template?.title)?.generic_template;
  if (template?.title) return { kind: "template", text: template.title.trim() };

  const image = parts.find((p) => p.image_data?.url)?.image_data;
  if (image) return { kind: "image", text: "Фото", url: image.url };

  const video = parts.find((p) => p.video_data?.url)?.video_data;
  if (video) return { kind: "video", text: "Видео", url: video.url };

  if (message.is_unsupported) {
    return { kind: "unsupported", text: "Instagram не отдаёт содержимое этого сообщения" };
  }
  return { kind: "reaction", text: "Реакция на сторис или пустое сообщение" };
}

/** Reads an NDJSON stream and yields each parsed line as it arrives. */
export async function* readNdjson<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }

  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as T;
}

/** Turns a failed fetch into a readable message instead of "[object Object]". */
export async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // fall through
  }
  return `Запрос не удался (HTTP ${response.status})`;
}
