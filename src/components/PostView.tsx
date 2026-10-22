"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MEDIA_TYPE_LABELS,
  PRODUCT_TYPE_LABELS,
  errorText,
  formatDate,
  formatDuration,
  formatNumber,
  formatSpan,
  isVideoMedia,
  metricLabel,
} from "@/lib/format";
import type {
  Comment,
  CommentsFile,
  InsightsFile,
  Media,
  MediaChild,
  TranscriptFile,
} from "@/lib/types";

interface Bundle {
  media: Media;
  comments: CommentsFile | null;
  insights: InsightsFile | null;
  transcript: TranscriptFile | null;
}

type Busy = "insights" | "comments" | "transcript" | null;

export function PostView({ id }: { id: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showSegments, setShowSegments] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/${id}`);
      if (!res.ok) throw new Error(await errorText(res));
      setBundle((await res.json()) as Bundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every "load X" button runs through here so errors surface the same way. */
  async function run(kind: Exclude<Busy, null>, url: string) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      setBundle((prev) => (prev ? { ...prev, [kind]: data } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Instagram withholds the author on many comments; say how many. */
  const anonymous = useMemo(() => {
    const all = bundle?.comments?.comments ?? [];
    const count = (list: Comment[]): number =>
      list.reduce((sum, c) => sum + (c.username ? 0 : 1) + count(c.replies ?? []), 0);
    return count(all);
  }, [bundle]);

  const visibleComments = useMemo(() => {
    const all = bundle?.comments?.comments ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    const matches = (c: Comment) =>
      c.text?.toLowerCase().includes(needle) || c.username?.toLowerCase().includes(needle);
    return all.filter((c) => matches(c) || (c.replies ?? []).some(matches));
  }, [bundle, query]);

  if (loading && !bundle) return <div className="card empty">Загружаем пост…</div>;
  if (!bundle) {
    return (
      <>
        <div className="notice error">{error ?? "Пост не найден"}</div>
        <Link className="btn" href="/posts">
          ← Ко всем постам
        </Link>
      </>
    );
  }

  const { media, comments, insights, transcript } = bundle;
  const video = isVideoMedia(media.media_type, media.media_product_type);
  const preview = media.thumbnail_url || media.media_url;
  const slides = media.children?.data ?? [];

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link className="muted" href="/posts">
            ← Все посты
          </Link>
          <h1 style={{ marginTop: 6 }}>
            {MEDIA_TYPE_LABELS[media.media_type] ?? media.media_type}
            {media.media_product_type && media.media_product_type !== "FEED"
              ? ` · ${PRODUCT_TYPE_LABELS[media.media_product_type] ?? media.media_product_type}`
              : ""}
          </h1>
          <p className="sub">
            {formatDate(media.timestamp)} ·{" "}
            <a className="mono" href={media.permalink} target="_blank" rel="noreferrer">
              открыть в Instagram ↗
            </a>
          </p>
        </div>
        <div className="row spacer">
          <a className="btn" href={`/api/export?kind=post&id=${media.id}`}>
            Выгрузить всё JSON
          </a>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}

      <div className="post-layout">
        <div>
          {slides.length ? (
            <Carousel slides={slides} alt={media.caption ?? "Пост"} />
          ) : (
            <Preview
              src={video ? media.media_url : preview}
              poster={media.thumbnail_url}
              video={video}
              alt={media.caption ?? "Пост"}
            />
          )}


          <div className="card" style={{ marginTop: 16 }}>
            <h2>Метаданные</h2>
            <dl className="meta-list">
              <dt>ID</dt>
              <dd className="mono">{media.id}</dd>
              <dt>Тип</dt>
              <dd>{media.media_type}</dd>
              <dt>Формат</dt>
              <dd>{media.media_product_type ?? "—"}</dd>
              <dt>Автор</dt>
              <dd>{media.username ? `@${media.username}` : "—"}</dd>
              <dt>Опубликован</dt>
              <dd>{formatDate(media.timestamp)}</dd>
              <dt>Лайки</dt>
              <dd>{formatNumber(media.like_count)}</dd>
              <dt>Комментарии</dt>
              <dd>{formatNumber(media.comments_count)}</dd>
              <dt>Комм. включены</dt>
              <dd>{media.is_comment_enabled === undefined ? "—" : media.is_comment_enabled ? "да" : "нет"}</dd>
              {media.children?.data?.length ? (
                <>
                  <dt>В карусели</dt>
                  <dd>{media.children.data.length}</dd>
                </>
              ) : null}
            </dl>
          </div>

          {media.caption ? (
            <div className="card">
              <h2>Описание</h2>
              <div className="comment-text">{media.caption}</div>
            </div>
          ) : null}
        </div>

        <div>
          <section className="card">
            <div className="row">
              <h2 style={{ margin: 0 }}>Статистика</h2>
              <div className="row spacer">
                <button onClick={() => void run("insights", `/api/media/${media.id}/insights`)} disabled={busy !== null}>
                  {busy === "insights" ? <span className="spin" /> : null}{" "}
                  {insights ? "Обновить" : "Загрузить статистику"}
                </button>
                <a
                  className="btn"
                  href={`/api/export?kind=insights&id=${media.id}`}
                  aria-disabled={!insights}
                  style={insights ? undefined : { opacity: 0.5, pointerEvents: "none" }}
                >
                  Выгрузить статистику
                </a>
              </div>
            </div>

            {insights ? (
              <>
                <div className="stats-grid" style={{ marginTop: 12 }}>
                  {statTiles(insights).map((tile) => (
                    <div className="stat" key={tile.name} title={tile.hint}>
                      <b>{tile.display}</b>
                      <span>{tile.label}</span>
                    </div>
                  ))}
                </div>
                <p className="sub">Обновлено {formatDate(insights.fetchedAt)}</p>
                {insights.unavailable.length ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="muted">
                      Instagram не отдал {insights.unavailable.length} метрик
                    </summary>
                    <ul className="muted" style={{ fontSize: 12 }}>
                      {insights.unavailable.map((u) => (
                        <li key={u.metric}>
                          <code>{u.metric}</code> — {u.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="sub">Ещё не загружена.</p>
            )}
          </section>

          {video ? (
            <section className="card">
              <div className="row">
                <h2 style={{ margin: 0 }}>Транскрипт видео</h2>
                <div className="row spacer">
                  <button
                    onClick={() =>
                      void run("transcript", `/api/media/${media.id}/transcript${transcript ? "?force=1" : ""}`)
                    }
                    disabled={busy !== null}
                  >
                    {busy === "transcript" ? <span className="spin" /> : null}{" "}
                    {transcript ? "Перетранскрибировать" : "Сделать транскрипт"}
                  </button>
                  <a
                    className="btn"
                    href={`/api/export?kind=transcript&id=${media.id}`}
                    style={transcript ? undefined : { opacity: 0.5, pointerEvents: "none" }}
                  >
                    Выгрузить транскрипт
                  </a>
                </div>
              </div>

              {busy === "transcript" ? (
                <p className="sub">Скачиваем видео и отправляем в OpenAI — это может занять минуту.</p>
              ) : null}

              {transcript ? (
                <>
                  <p className="sub">
                    {transcript.model}
                    {transcript.language ? ` · язык: ${transcript.language}` : ""}
                    {transcript.duration ? ` · ${formatDuration(transcript.duration)}` : ""} ·{" "}
                    {formatDate(transcript.transcribedAt)}
                    {transcript.segments.length ? (
                      <>
                        {" · "}
                        <button className="ghost" onClick={() => setShowSegments((v) => !v)}>
                          {showSegments ? "сплошным текстом" : `по таймкодам (${transcript.segments.length})`}
                        </button>
                      </>
                    ) : null}
                  </p>
                  <div className="transcript" style={{ marginTop: 8 }}>
                    {showSegments && transcript.segments.length ? (
                      <div className="segments">
                        {transcript.segments.map((segment) => (
                          <div key={segment.id} style={{ display: "contents" }}>
                            <span className="t">{formatDuration(segment.start)}</span>
                            <span>{segment.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      transcript.text || <span className="muted">Речь не распознана.</span>
                    )}
                  </div>
                </>
              ) : busy !== "transcript" ? (
                <p className="sub">Ещё не создан.</p>
              ) : null}
            </section>
          ) : null}

          <section className="card">
            <div className="row">
              <h2 style={{ margin: 0 }}>
                Комментарии{" "}
                {comments ? (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {formatNumber(comments.count)} +{" "}
                    {formatNumber(comments.totalWithReplies - comments.count)} ответов
                    {comments.expected ? ` из ${formatNumber(comments.expected)} по данным Instagram` : ""}
                  </span>
                ) : null}
              </h2>
              <div className="row spacer">
                <button onClick={() => void run("comments", `/api/media/${media.id}/comments`)} disabled={busy !== null}>
                  {busy === "comments" ? <span className="spin" /> : null}{" "}
                  {comments ? "Обновить" : "Загрузить комментарии"}
                </button>
                <a
                  className="btn"
                  href={`/api/export?kind=comments&id=${media.id}`}
                  style={comments ? undefined : { opacity: 0.5, pointerEvents: "none" }}
                >
                  Выгрузить комментарии
                </a>
              </div>
            </div>

            {comments?.warning ? (
              <div className="notice warn" style={{ marginTop: 12, marginBottom: 0 }}>
                {comments.warning}
              </div>
            ) : null}

            {comments ? (
              <>
                <div className="row" style={{ margin: "14px 0 0" }}>
                  <input
                    className="search"
                    type="search"
                    placeholder="Поиск по комментариям…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <span className="sub spacer" style={{ margin: 0 }}>
                    Обновлено {formatDate(comments.fetchedAt)}
                  </span>
                </div>

                {anonymous > 0 ? (
                  <p className="sub">
                    Instagram не раскрыл автора у {formatNumber(anonymous)} из{" "}
                    {formatNumber(comments.totalWithReplies)} комментариев — имена скрыты на его
                    стороне, дозагрузить их нельзя.
                  </p>
                ) : null}

                {visibleComments.length === 0 ? (
                  <p className="sub">
                    {comments.count
                      ? "Ничего не найдено."
                      : comments.warning
                        ? "Instagram не отдал ни одного комментария — причина выше."
                        : "Комментариев нет."}
                  </p>
                ) : (
                  visibleComments.map((comment) => <CommentRow key={comment.id} comment={comment} />)
                )}
              </>
            ) : (
              <p className="sub">Ещё не загружены.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * All slides of a carousel, not just the cover.
 *
 * Instagram returns every child with its own `media_url`, so the whole album is
 * already on disk — it just had nowhere to be shown. Albums here run to twenty
 * slides, hence a strip of numbered thumbnails rather than a wall of images.
 */
function Carousel({ slides, alt }: { slides: MediaChild[]; alt: string }) {
  const [index, setIndex] = useState(0);
  const current = slides[Math.min(index, slides.length - 1)];
  const step = (delta: number) => setIndex((i) => (i + delta + slides.length) % slides.length);

  return (
    <>
      <Preview
        src={current.media_url}
        poster={current.thumbnail_url}
        video={current.media_type === "VIDEO"}
        alt={alt}
      />

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => step(-1)} aria-label="Предыдущий слайд">
          ‹
        </button>
        <span className="mono muted">
          {index + 1} / {slides.length}
        </span>
        <button onClick={() => step(1)} aria-label="Следующий слайд">
          ›
        </button>
        <a
          className="mono muted spacer"
          href={current.permalink}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: "auto" }}
        >
          слайд в Instagram ↗
        </a>
      </div>

      <div className="slides">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            className="slide-thumb"
            data-active={i === index}
            onClick={() => setIndex(i)}
            title={`Слайд ${i + 1}`}
          >
            {slide.media_url && slide.media_type !== "VIDEO" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slide.thumbnail_url || slide.media_url} alt="" loading="lazy" />
            ) : (
              <span className="mono">{i + 1}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * `media_url` and `thumbnail_url` are short-lived CDN links. When one has
 * expired, say so instead of leaving a broken-image icon.
 */
function Preview({
  src,
  poster,
  video,
  alt,
}: {
  src?: string;
  poster?: string;
  video: boolean;
  alt: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div className="card empty">
        Превью недоступно — ссылка Instagram устарела.
        <br />
        Обновите список постов на странице «Все посты».
      </div>
    );
  }

  if (video) {
    return (
      <video
        className="media-frame"
        src={src}
        poster={poster}
        controls
        onError={() => setBroken(true)}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="media-frame" src={src} alt={alt} onError={() => setBroken(true)} />;
}

/** Metrics Meta reports in milliseconds — shown as a duration, not a raw count. */
const MS_METRICS = new Set(["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]);

/** Metrics Meta reports as a percentage. */
const RATE_METRICS = new Set(["reels_skip_rate"]);

interface Tile {
  name: string;
  label: string;
  display: string;
  hint?: string;
}

/**
 * `likes` / `comments` arrive both as insight metrics and as counters on the
 * media object. Prefer the metric and fall back to the counter, so neither is
 * shown twice and neither goes missing.
 */
function statTiles(insights: InsightsFile): Tile[] {
  const tiles: Tile[] = Object.entries(insights.metrics).map(([name, metric]) => ({
    name,
    label: metricLabel(name).replace(" (мс)", ""),
    display: MS_METRICS.has(name)
      ? formatSpan(metric.value / 1000)
      : RATE_METRICS.has(name)
        ? `${metric.value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`
        : formatNumber(metric.value),
    hint: metric.description ?? name,
  }));

  const fallbacks: [string, string, number | undefined][] = [
    ["likes", "Лайки", insights.counts.like_count],
    ["comments", "Комментарии", insights.counts.comments_count],
  ];
  for (const [name, label, value] of fallbacks) {
    if (value !== undefined && !insights.metrics[name]) {
      tiles.unshift({ name, label, display: formatNumber(value), hint: "Из данных поста" });
    }
  }

  return tiles;
}

function CommentRow({ comment, nested = false }: { comment: Comment; nested?: boolean }) {
  return (
    <div className="comment" style={nested ? { paddingBottom: 6 } : undefined}>
      <div className="comment-head">
        {comment.username ? (
          <b>@{comment.username}</b>
        ) : (
          <b className="muted" title="Instagram не раскрывает автора этого комментария">
            имя скрыто
          </b>
        )}
        <span className="mono muted">{formatDate(comment.timestamp)}</span>
        {comment.like_count ? <span className="tag">♥ {formatNumber(comment.like_count)}</span> : null}
        {comment.hidden ? <span className="tag">скрыт</span> : null}
      </div>
      <div className="comment-text">{comment.text}</div>
      {comment.replies?.length ? (
        <div className="replies">
          {comment.replies.map((reply) => (
            <CommentRow key={reply.id} comment={reply} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}
