"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeMessage, errorText, formatDate, formatNumber, truncate } from "@/lib/format";
import type { ConversationFile, ConversationSummary } from "@/lib/types";
import { useSync } from "./useSync";

interface ListResponse {
  igUserId: string | null;
  total?: number;
  awaitingReply?: number;
  conversations: ConversationSummary[];
}

/** Renders whatever the message turned out to be: text, a photo, or a label. */
function MessageBody({ body }: { body: ReturnType<typeof describeMessage> }) {
  const [broken, setBroken] = useState(false);

  if (body.kind === "image" && body.url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="dm-media"
        src={body.url}
        alt="Вложение"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }

  if (body.kind === "video" && body.url && !broken) {
    return <video className="dm-media" src={body.url} controls onError={() => setBroken(true)} />;
  }

  const plain = body.kind === "text" || body.kind === "template";
  return (
    <div className={plain ? "comment-text" : "comment-text muted"}>
      {broken ? "Вложение недоступно — ссылка Instagram устарела" : body.text}
    </div>
  );
}

export function MessagesView() {
  const [list, setList] = useState<ListResponse>({ igUserId: null, conversations: [] });
  const [thread, setThread] = useState<ConversationFile | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // A chat opens at the newest message, not the oldest. The thread box scrolls,
  // so without this the freshest messages sit below the fold.
  useEffect(() => {
    const box = threadRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [thread]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) setList((await res.json()) as ListResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link: /messages?id=<conversation> opens that thread straight away.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("id");
    if (wanted) void open(wanted);
    // Runs once on mount; `open` is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { state: sync, start, cancel } = useSync(load);

  async function open(id: string) {
    window.history.replaceState({}, "", openId === id ? "/messages" : `/messages?id=${id}`);
    if (openId === id) {
      setOpenId(null);
      setThread(null);
      return;
    }
    setOpenId(id);
    setThread(null);
    setSent(null);
    setReply("");
    const res = await fetch(`/api/conversations/${id}?full=1`);
    if (res.ok) setThread((await res.json()) as ConversationFile);
  }

  async function send(id: string) {
    if (!reply.trim()) return;
    // A real message to a real person — make the user say it out loud first.
    if (!window.confirm(`Отправить сообщение?\n\n${reply.trim()}`)) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.trim() }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      setReply("");
      setSent("Отправлено.");
      const fresh = await fetch(`/api/conversations/${id}`);
      if (fresh.ok) setThread((await fresh.json()) as ConversationFile);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.conversations.filter((c) => {
      if (onlyUnanswered && !c.needsReply) return false;
      if (!needle) return true;
      return (
        c.counterpart?.username?.toLowerCase().includes(needle) ||
        c.lastMessagePreview?.toLowerCase().includes(needle)
      );
    });
  }, [list, query, onlyUnanswered]);

  const percent = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Директ</h1>
          <p className="sub">
            {loading
              ? "Загружаем…"
              : list.conversations.length
                ? `${formatNumber(list.total ?? 0)} диалогов · ${formatNumber(list.awaitingReply ?? 0)} ждут ответа`
                : "Диалоги ещё не загружены"}
          </p>
        </div>
        <div className="row spacer">
          <a className="btn" href="/api/export?kind=all-messages">
            Выгрузить JSON
          </a>
          <button
            className="primary"
            onClick={() =>
              void start("comments", "/api/sync/messages", (n) => `${formatNumber(n)} сообщений`)
            }
            disabled={sync.running}
          >
            {sync.running ? <span className="spin" /> : null} Загрузить диалоги
          </button>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {sync.error ? <div className="notice error">{sync.error}</div> : null}

      {sync.running || sync.summary ? (
        <div className={`notice ${sync.failed ? "warn" : "ok"}`}>
          {sync.running
            ? `Загружаем диалоги: ${sync.done} из ${sync.total || "?"} — ${formatNumber(sync.count)} сообщений`
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
          <button data-active={!onlyUnanswered} onClick={() => setOnlyUnanswered(false)}>
            Все
          </button>
          <button data-active={onlyUnanswered} onClick={() => setOnlyUnanswered(true)}>
            Ждут ответа
          </button>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Поиск по собеседнику или тексту…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!loading && rows.length === 0 ? (
        <div className="card empty">
          {list.conversations.length
            ? "Ничего не найдено."
            : "Нажмите «Загрузить диалоги» — приложение выгрузит переписку из Instagram."}
        </div>
      ) : null}

      {rows.map((c) => {
        const expanded = openId === c.id;
        return (
          <section className="card" key={c.id}>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <b>{c.counterpart?.username ? `@${c.counterpart.username}` : "Без имени"}</b>
                <p className="sub" style={{ margin: "2px 0 0" }}>
                  {formatNumber(c.messageCount)} сообщений · {formatDate(c.lastMessageAt)}
                </p>
                {c.lastMessagePreview ? (
                  <p className="sub" style={{ margin: "6px 0 0" }}>
                    {truncate(c.lastMessagePreview, 120)}
                  </p>
                ) : null}
              </div>
              <div className="row spacer" style={{ gap: 6 }}>
                {c.needsReply ? (
                  <span className={c.replyWindowOpen ? "tag tag--blue" : "tag tag--amber"}>
                    {c.replyWindowOpen ? "ждёт ответа" : "окно закрыто"}
                  </span>
                ) : null}
                <button className="ghost" onClick={() => void open(c.id)}>
                  {expanded ? "свернуть" : "открыть"}
                </button>
              </div>
            </div>

            {expanded && !thread ? <p className="sub">Загружаем переписку…</p> : null}

            {expanded && thread ? (
              <>
                <div className="thread" ref={threadRef}>
                  {[...thread.messages].reverse().map((m) => {
                    const mine = m.from?.id === list.igUserId;
                    const body = describeMessage(m);
                    return (
                      <div key={m.id} className={`bubble ${mine ? "mine" : ""}`}>
                        <div className="mono muted">
                          {mine ? "Я" : `@${m.from?.username ?? "собеседник"}`} ·{" "}
                          {formatDate(m.created_time)}
                          {body.kind === "template" ? " · шаблон автоворонки" : ""}
                        </div>
                        <MessageBody body={body} />
                      </div>
                    );
                  })}
                </div>

                {sent ? <p className="sub">{sent}</p> : null}

                {c.replyWindowOpen ? (
                  <div style={{ marginTop: 12 }}>
                    <textarea
                      rows={3}
                      style={{ width: "100%" }}
                      placeholder="Ответ…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      disabled={sending}
                    />
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        className="primary"
                        onClick={() => void send(c.id)}
                        disabled={sending || !reply.trim()}
                      >
                        {sending ? <span className="spin" /> : null} Отправить
                      </button>
                      <span className="sub" style={{ margin: 0 }}>
                        Уйдёт в реальный директ — приложение переспросит перед отправкой.
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="sub">
                    Отправка недоступна: Instagram разрешает отвечать в течение 24 часов после
                    последнего сообщения собеседника. Ответить можно только из приложения Instagram.
                  </p>
                )}
              </>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
