"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { errorText, formatDate, formatNumber, formatPercent } from "@/lib/format";
import type { TopicsFile, TopicsPlan } from "@/lib/types";
import { useSync } from "./useSync";

export function TopicsView() {
  const [file, setFile] = useState<TopicsFile | null>(null);
  const [plan, setPlan] = useState<TopicsPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/topics");
      setFile(res.ok ? ((await res.json()) as TopicsFile) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { state: sync, start, cancel } = useSync(load);

  async function askPlan() {
    setError(null);
    try {
      const res = await fetch("/api/analyze/topics");
      if (!res.ok) throw new Error(await errorText(res));
      setPlan((await res.json()) as TopicsPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function run() {
    setPlan(null);
    setError(null);
    void start("comments", "/api/analyze/topics", (n) => `${formatNumber(n)} комментариев`);
  }

  const percent = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const totalQuestions = (file?.topics ?? []).reduce((sum, t) => sum + t.questionCount, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Темы комментариев</h1>
          <p className="sub">
            {file
              ? `${formatNumber(file.topics.length)} тем · разобрано ${formatNumber(file.analyzed)} из ` +
                `${formatNumber(file.totalComments)} комментариев · ${formatNumber(totalQuestions)} вопросов · ` +
                `${file.model} · ${formatDate(file.createdAt)}`
              : loading
                ? "Загружаем…"
                : "Анализ ещё не запускался"}
          </p>
        </div>
        <div className="row spacer">
          {file ? (
            <a className="btn" href="/api/export?kind=topics">
              Выгрузить JSON
            </a>
          ) : null}
          <button className="primary" onClick={() => void askPlan()} disabled={sync.running}>
            {sync.running ? <span className="spin" /> : null}
            {file ? "Пересобрать" : "Разобрать комментарии"}
          </button>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {sync.error ? <div className="notice error">{sync.error}</div> : null}

      {plan ? (
        <div className="notice">
          {plan.analyzable === 0 ? (
            <>Нет комментариев для анализа. Сначала загрузите их на странице «Все посты».</>
          ) : (
            <>
              Будет разобрано {formatNumber(plan.analyzable)} комментариев за {plan.batches} запросов
              к {plan.model}, ориентировочно ${plan.estimatedUsd.toFixed(2)}.{" "}
              {formatNumber(plan.reactionsOnly)} реакций без текста пропускаются — они ничего не
              добавят, но стоили бы денег.
              {plan.existing
                ? ` Предыдущий разбор от ${formatDate(plan.existing.createdAt)} будет заменён.`
                : ""}
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {plan.analyzable > 0 ? (
              <button className="primary" onClick={run}>
                Разобрать
              </button>
            ) : null}
            <button onClick={() => setPlan(null)}>Отмена</button>
          </div>
        </div>
      ) : null}

      {sync.running || sync.summary ? (
        <div className={`notice ${sync.failed ? "warn" : "ok"}`}>
          {sync.running
            ? `Классифицируем: пакет ${sync.done} из ${sync.total || "?"} — ${formatNumber(sync.count)} комментариев`
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
        </div>
      ) : null}

      {!file && !loading && !sync.running ? (
        <div className="card empty">
          Тем пока нет. Нажмите «Разобрать комментарии» — приложение сгруппирует архив в
          повторяющиеся темы, а каждая частая группа вопросов это готовая тема для ролика.
        </div>
      ) : null}

      {file
        ? file.topics.map((topic) => {
            const share = file.analyzed ? topic.count / file.analyzed : 0;
            const expanded = open === topic.id;
            return (
              <section className="card" key={topic.id}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ margin: 0 }}>{topic.name}</h2>
                    <p className="sub" style={{ margin: "4px 0 0" }}>
                      {topic.description}
                    </p>
                  </div>
                  <div className="row spacer" style={{ gap: 6 }}>
                    {topic.questionCount ? (
                      <span className="tag tag--blue">
                        {formatNumber(topic.questionCount)} вопросов
                      </span>
                    ) : null}
                    <span className="tag">{formatNumber(topic.postCount)} постов</span>
                    <span className="tag tag--green">
                      {formatNumber(topic.count)} · {formatPercent(share, 0)}
                    </span>
                  </div>
                </div>

                <div className="progress" style={{ color: "var(--accent)" }}>
                  <div style={{ width: `${Math.round(share * 100)}%` }} />
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <button className="ghost" onClick={() => setOpen(expanded ? null : topic.id)}>
                    {expanded ? "скрыть примеры" : `примеры (${topic.examples.length})`}
                  </button>
                </div>

                {expanded
                  ? topic.examples.map((example) => (
                      <div className="comment" key={example.commentId}>
                        <div className="comment-text">{example.text}</div>
                        <Link className="mono muted" href={`/posts/${example.mediaId}`}>
                          → к посту
                        </Link>
                      </div>
                    ))
                  : null}
              </section>
            );
          })
        : null}
    </>
  );
}
