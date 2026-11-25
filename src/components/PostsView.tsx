"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MEDIA_TYPE_LABELS,
  PRODUCT_TYPE_LABELS,
  errorText,
  formatDate,
  formatNumber,
  formatPercent,
  productTagClass,
  truncate,
} from "@/lib/format";
import type {
  AccountInsights,
  Media,
  MediaIndex,
  MetricsFile,
  PostMetrics,
  TranscribePlan,
} from "@/lib/types";
import { type SyncKind, useSync } from "./useSync";

type Status = {
  comments: string[];
  /** How many comments each saved file actually contains, keyed by media id. */
  commentsFetched: Record<string, number>;
  insights: string[];
  transcripts: string[];
};

const NO_STATUS: Status = { comments: [], commentsFetched: {}, insights: [], transcripts: [] };

/** off = never fetched, empty = fetched but Instagram withheld it, on = have data. */
function commentState(status: Status, id: string, expected: number): "on" | "empty" | "off" {
  if (!status.comments.includes(id)) return "off";
  return (status.commentsFetched[id] ?? 0) === 0 && expected > 0 ? "empty" : "on";
}

/** The three bulk jobs, all driven by the same NDJSON progress stream. */
const JOBS: Record<SyncKind, { url: string; button: string; unit: (n: number) => string }> = {
  comments: {
    url: "/api/sync/comments",
    button: "Загрузить все комментарии",
    unit: (n) => `${formatNumber(n)} комментариев`,
  },
  insights: {
    url: "/api/sync/insights",
    button: "Загрузить всю статистику",
    unit: (n) => `${formatNumber(n)} метрик`,
  },
  transcripts: {
    url: "/api/sync/transcripts",
    button: "Расшифровать все видео",
    unit: (n) => `${formatNumber(n)} роликов`,
  },
};

/**
 * Table columns. `basics` is the content view, `performance` the analytics one —
 * one row of 14 columns would scroll off the screen and be read by nobody.
 */
type View = "basics" | "performance";

interface Row {
  media: Media;
  metrics?: PostMetrics;
}

type SortKey =
  | "timestamp"
  | "media_type"
  | "like_count"
  | "comments_count"
  | "reach"
  | "views"
  | "saved"
  | "shares"
  | "retention"
  | "skipRate"
  | "er"
  | "savedPerReach"
  | "sharesPerReach";

/** Sort accessors. Everything numeric so one comparator handles the lot. */
const SORT: Record<SortKey, (row: Row) => number | string> = {
  timestamp: (r) => r.media.timestamp ?? "",
  media_type: (r) => r.media.media_type ?? "",
  like_count: (r) => r.media.like_count ?? 0,
  comments_count: (r) => r.media.comments_count ?? 0,
  reach: (r) => r.metrics?.reach ?? -1,
  views: (r) => r.metrics?.views ?? -1,
  saved: (r) => r.metrics?.saved ?? -1,
  shares: (r) => r.metrics?.shares ?? -1,
  retention: (r) => r.metrics?.retention ?? -1,
  skipRate: (r) => r.metrics?.skipRate ?? -1,
  er: (r) => r.metrics?.er ?? -1,
  savedPerReach: (r) => r.metrics?.savedPerReach ?? -1,
  sharesPerReach: (r) => r.metrics?.sharesPerReach ?? -1,
};

export function PostsView() {
  const [index, setIndex] = useState<MediaIndex | null>(null);
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const [metrics, setMetrics] = useState<MetricsFile | null>(null);
  const [followers, setFollowers] = useState<AccountInsights | null>(null);
  const [view, setView] = useState<View>("basics");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "timestamp", desc: true });
  const [plan, setPlan] = useState<TranscribePlan | null>(null);
  /** Set when the plan on screen belongs to «Выгрузить всё», not plain transcription. */
  const [exportAfter, setExportAfter] = useState(false);
  /** True for the whole «Выгрузить всё» chain, including the gaps between its runs. */
  const [exporting, setExporting] = useState(false);

  const loadSide = useCallback(async () => {
    const [statusRes, metricsRes, followersRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/metrics"),
      fetch("/api/account-insights"),
    ]);
    if (statusRes.ok) setStatus((await statusRes.json()) as Status);
    if (metricsRes.ok) setMetrics((await metricsRes.json()) as MetricsFile);
    if (followersRes.ok) setFollowers((await followersRes.json()) as AccountInsights);
  }, []);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/media${refresh ? "?refresh=1" : ""}`);
        if (!res.ok) throw new Error(await errorText(res));
        setIndex((await res.json()) as MediaIndex);
        await loadSide();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [loadSide],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Keep the active view in the URL so a sorted analytics table can be linked to.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "performance") {
      setView("performance");
      setSort({ key: "reach", desc: true });
    }
  }, []);

  const switchView = (next: View) => {
    setView(next);
    if (next === "performance" && sort.key === "timestamp") setSort({ key: "reach", desc: true });
    if (next === "basics" && !(sort.key in { timestamp: 1, like_count: 1, comments_count: 1 })) {
      setSort({ key: "timestamp", desc: true });
    }
    const url = next === "performance" ? "/posts?view=performance" : "/posts";
    window.history.replaceState({}, "", url);
  };

  const afterSync = useCallback(async () => {
    await Promise.all([load(false), loadSide()]);
  }, [load, loadSide]);

  const { state: sync, start, cancel } = useSync(afterSync);

  const run = (kind: SyncKind) => {
    setPlan(null);
    setError(null);
    return start(kind, JOBS[kind].url, JOBS[kind].unit);
  };

  const downloadEverything = () => {
    window.location.href = "/api/export?kind=everything";
  };

  /** Transcription costs real money, so show the bill before spending it. */
  async function askTranscripts(thenExport = false) {
    setError(null);
    setExportAfter(thenExport);
    try {
      const res = await fetch("/api/sync/transcripts");
      if (!res.ok) throw new Error(await errorText(res));
      const next = (await res.json()) as TranscribePlan;
      // Nothing to transcribe means nothing to pay for — no reason to ask.
      if (thenExport && next.pending === 0) return void refreshAndExport(false);
      setPlan(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Optionally transcribes whatever is missing, re-pulls every post's insights and
   * comments, then hands over one file with everything. Transcripts go first: a
   * Reel's retention needs its duration, and that only comes from the transcript. Stops without a download if a run is cancelled
   * or fails outright; a run that hit the Instagram limit still counts as finished
   * and exports what was saved, with the warning left on screen.
   */
  async function refreshAndExport(transcribe: boolean) {
    setExporting(true);
    try {
      if (transcribe && !(await run("transcripts"))) return;
      if (!(await run("insights"))) return;
      if (!(await run("comments"))) return;
      downloadEverything();
    } finally {
      setExporting(false);
    }
  }

  const byId = useMemo(() => {
    const map = new Map<string, PostMetrics>();
    for (const row of metrics?.rows ?? []) map.set(row.mediaId, row);
    return map;
  }, [metrics]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (index?.media ?? [])
      .filter(
        (m) =>
          !needle ||
          m.caption?.toLowerCase().includes(needle) ||
          m.id.includes(needle) ||
          m.media_type.toLowerCase().includes(needle) ||
          m.media_product_type?.toLowerCase().includes(needle),
      )
      .map((media): Row => ({ media, metrics: byId.get(media.id) }));

    const direction = sort.desc ? -1 : 1;
    const get = SORT[sort.key];
    return filtered.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * direction;
      }
      return (av - bv) * direction;
    });
  }, [index, byId, query, sort]);

  const totals = useMemo(() => {
    const media = index?.media ?? [];
    return {
      likes: media.reduce((sum, m) => sum + (m.like_count ?? 0), 0),
      comments: media.reduce((sum, m) => sum + (m.comments_count ?? 0), 0),
    };
  }, [index]);

  const header = (key: SortKey, label: string, numeric = true, hint?: string) => (
    <th
      className={numeric ? "num" : undefined}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
      title={hint ?? "Сортировать"}
    >
      {label}
      {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  const percent = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const summary = index
    ? [
        `${formatNumber(index.count)} постов`,
        `${formatNumber(totals.likes)} лайков`,
        `${formatNumber(totals.comments)} комментариев`,
        metrics?.medianReach ? `медиана охвата ${formatNumber(metrics.medianReach)}` : null,
        metrics?.medianRetention ? `медиана досмотра ${formatPercent(metrics.medianRetention)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Загружаем…";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Все посты</h1>
          <p className="sub">{summary}</p>
        </div>
        <div className="row spacer">
          <button onClick={() => void load(true)} disabled={loading || sync.running || exporting}>
            {loading ? <span className="spin" /> : null} Обновить список
          </button>
          <button onClick={() => void run("insights")} disabled={sync.running || exporting}>
            {JOBS.insights.button}
          </button>
          <button onClick={() => void askTranscripts()} disabled={sync.running || exporting}>
            {JOBS.transcripts.button}
          </button>
          <button className="primary" onClick={() => void run("comments")} disabled={sync.running || exporting}>
            {sync.running ? <span className="spin" /> : null} {JOBS.comments.button}
          </button>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {sync.error ? <div className="notice error">{sync.error}</div> : null}

      {plan ? (
        <div className="notice">
          {plan.pending === 0 ? (
            <>Все {formatNumber(plan.alreadyDone)} видео уже расшифрованы — делать нечего.</>
          ) : (
            <>
              Будет расшифровано {formatNumber(plan.pending)} видео (уже готово{" "}
              {formatNumber(plan.alreadyDone)}). Ориентировочно{" "}
              {formatNumber(Math.round(plan.estimatedMinutes))} минут аудио, около $
              {plan.estimatedUsd.toFixed(2)} по тарифу whisper-1.{" "}
              {plan.basedOnSamples
                ? `Оценка по средней длине ${plan.basedOnSamples} уже расшифрованных роликов.`
                : "Точной оценки нет — ни один ролик ещё не расшифрован, взята длина 60 секунд."}
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {plan.pending > 0 ? (
              exportAfter ? (
                <>
                  <button className="primary" onClick={() => void refreshAndExport(true)}>
                    Расшифровать и выгрузить
                  </button>
                  <button onClick={() => void refreshAndExport(false)}>
                    Выгрузить без расшифровки
                  </button>
                </>
              ) : (
                <button className="primary" onClick={() => void run("transcripts")}>
                  Расшифровать
                </button>
              )
            ) : null}
            <button onClick={() => setPlan(null)}>Отмена</button>
          </div>
        </div>
      ) : null}

      {sync.running || sync.summary ? (
        <div className={`notice ${sync.failed || sync.flagged ? "warn" : "ok"}`}>
          {sync.running && sync.kind
            ? `${JOBS[sync.kind].button}: ${sync.done} из ${sync.total || "?"} — ${JOBS[sync.kind].unit(sync.count)}`
            : sync.summary}
          {sync.running ? (
            <>
              <div className="progress">
                <div style={{ width: `${percent}%` }} />
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={cancel}>Остановить</button>
              </div>
            </>
          ) : null}
          {!sync.running && sync.warning ? (
            <p style={{ margin: "8px 0 0" }}>{sync.warning}</p>
          ) : null}
        </div>
      ) : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="segmented">
          <button data-active={view === "basics"} onClick={() => switchView("basics")}>
            Содержание
          </button>
          <button data-active={view === "performance"} onClick={() => switchView("performance")}>
            Эффективность
          </button>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Поиск по описанию, типу или id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="row spacer">
          <a className="btn" href="/api/export?kind=media">
            Посты
          </a>
          <a className="btn" href="/api/export?kind=all-comments">
            Комментарии
          </a>
          <a className="btn" href="/api/export?kind=all-insights">
            Статистика
          </a>
          <a className="btn" href="/api/export?kind=all-transcripts">
            Транскрипты
          </a>
          <button
            className="primary"
            onClick={() => void askTranscripts(true)}
            disabled={sync.running || exporting}
            title="Расшифровать недостающие видео, заново загрузить статистику и комментарии и скачать один JSON со всеми постами, статистикой, комментариями и транскриптами"
          >
            Выгрузить всё
          </button>
        </div>
      </div>

      {view === "performance" ? <FollowerCard data={followers} onRefresh={loadSide} /> : null}

      {view === "performance" && metrics && metrics.withRetention < metrics.count ? (
        <p className="sub" style={{ margin: "0 0 12px" }}>
          Досмотр посчитан для {metrics.withRetention} из {metrics.count} постов — для остального
          нужна длительность ролика, а она берётся из транскрипта.
        </p>
      ) : null}

      {!loading && rows.length === 0 ? (
        <div className="card empty">
          {index?.count
            ? "Ничего не найдено по этому запросу."
            : "Постов пока нет. Проверьте подключение аккаунта в Настройках."}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              {view === "basics" ? (
                <tr>
                  <th className="plain" />
                  <th className="plain">Пост</th>
                  {header("media_type", "Тип", false)}
                  {header("timestamp", "Опубликован", false)}
                  {header("like_count", "Лайки")}
                  {header("comments_count", "Комм.")}
                  <th className="plain">Загружено</th>
                </tr>
              ) : (
                <tr>
                  <th className="plain" />
                  <th className="plain">Пост</th>
                  {header("reach", "Охват")}
                  {header("views", "Просмотры")}
                  {header("retention", "Досмотр", true, "Средний просмотр ÷ длительность ролика")}
                  {header("skipRate", "Пропуски", true, "Доля зрителей, пролиставших ролик")}
                  {header("er", "ER", true, "Все взаимодействия ÷ охват")}
                  {header("savedPerReach", "Сохр.", true, "Сохранения ÷ охват")}
                  {header("sharesPerReach", "Репосты", true, "Репосты ÷ охват")}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map(({ media, metrics: m }) => (
                <tr key={media.id}>
                  <td>
                    <Link href={`/posts/${media.id}`}>
                      <Thumb src={media.thumbnail_url || media.media_url} />
                    </Link>
                  </td>
                  <td className="caption-cell">
                    <Link href={`/posts/${media.id}`}>
                      {truncate(media.caption, view === "performance" ? 60 : 90) || (
                        <span className="muted">Без описания</span>
                      )}
                    </Link>
                    <div className="mono muted">{formatDate(media.timestamp)}</div>
                  </td>

                  {view === "basics" ? (
                    <>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <span className="tag">
                            {MEDIA_TYPE_LABELS[media.media_type] ?? media.media_type}
                            {media.children?.data?.length
                              ? ` · ${media.children.data.length}`
                              : ""}
                          </span>
                          {media.media_product_type && media.media_product_type !== "FEED" ? (
                            <span className={productTagClass(media.media_product_type)}>
                              {PRODUCT_TYPE_LABELS[media.media_product_type] ??
                                media.media_product_type}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="mono muted">{formatDate(media.timestamp)}</td>
                      <td className="num">{formatNumber(media.like_count)}</td>
                      <td className="num">{formatNumber(media.comments_count)}</td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <Badge
                            state={commentState(status, media.id, media.comments_count ?? 0)}
                            label="комм."
                          />
                          <Badge
                            state={status.insights.includes(media.id) ? "on" : "off"}
                            label="стат."
                          />
                          <Badge
                            state={status.transcripts.includes(media.id) ? "on" : "off"}
                            label="транскр."
                          />
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">{formatNumber(m?.reach)}</td>
                      <td className="num">{formatNumber(m?.views)}</td>
                      <td className="num">{formatPercent(m?.retention)}</td>
                      <td className="num muted">
                        {m?.skipRate === undefined ? "—" : `${m.skipRate.toFixed(1)} %`}
                      </td>
                      <td className="num">{formatPercent(m?.er)}</td>
                      <td className="num">{formatPercent(m?.savedPerReach, 2)}</td>
                      <td className="num">{formatPercent(m?.sharesPerReach, 2)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Follower growth for the account as a whole.
 *
 * This is here because the per-post `follows` metric cannot answer the question
 * for this account: Instagram does not report it for Reels at all, so summing
 * what the feed posts return describes a small minority of the archive.
 */
function FollowerCard({ data, onRefresh }: { data: AccountInsights | null; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account-insights?refresh=1");
      if (!res.ok) throw new Error(await errorText(res));
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const series = data?.followerCount ?? [];
  const last30 = series.slice(-30).reduce((sum, point) => sum + point.value, 0);
  const last7 = series.slice(-7).reduce((sum, point) => sum + point.value, 0);

  return (
    <section className="card card-soft" style={{ marginBottom: 16 }}>
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>Подписчики</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Подписки нельзя приписать конкретному Reels — Instagram не отдаёт метрику follows для
            этого формата. Поэтому прирост считается по аккаунту целиком.
          </p>
        </div>
        <div className="row spacer">
          <button onClick={() => void refresh()} disabled={busy}>
            {busy ? <span className="spin" /> : null} Обновить
          </button>
        </div>
      </div>

      {error ? (
        <p className="sub" style={{ color: "var(--err)" }}>
          {error}
        </p>
      ) : null}

      {series.length ? (
        <>
          <div className="stats-grid" style={{ marginTop: 14 }}>
            <div className="stat">
              <b>+{formatNumber(last7)}</b>
              <span>за 7 дней</span>
            </div>
            <div className="stat">
              <b>+{formatNumber(last30)}</b>
              <span>за 30 дней</span>
            </div>
            <div className="stat">
              <b>{formatNumber(series.length)}</b>
              <span>дней в истории</span>
            </div>
          </div>
          <p className="sub">
            Новые подписчики по данным Instagram; отписки он не вычитает. За один запрос отдаётся
            не больше 30 дней, поэтому история копится с момента первого сбора.
          </p>
        </>
      ) : (
        <p className="sub">Ещё не собирались — нажмите «Обновить».</p>
      )}
    </section>
  );
}

/** Instagram's CDN links expire, so a dead thumbnail is normal, not an error. */
function Thumb({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) return <div className="thumb" title="Превью недоступно — обновите список" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="thumb" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
  );
}

const BADGE = {
  on: { className: "tag tag--green", title: "Есть на диске" },
  empty: { className: "tag tag--amber", title: "Загружено, но Instagram вернул пусто" },
  off: { className: "tag tag--off", title: "Не загружено" },
} as const;

function Badge({ state, label }: { state: keyof typeof BADGE; label: string }) {
  const style = BADGE[state];
  return (
    <span className={style.className} title={style.title}>
      <span className={`dot ${state === "off" ? "" : "on"}`} />
      {label}
    </span>
  );
}
