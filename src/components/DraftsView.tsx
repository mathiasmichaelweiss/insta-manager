"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, formatDate, formatDuration, formatNumber } from "@/lib/format";
import type { Draft } from "@/lib/types";
import { AgentGuide } from "./AgentGuide";

const MB = 1024 * 1024;

/** The list endpoint drops the word timings and reports only how many there are. */
type DraftRow = Omit<Draft, "words"> & { wordCount?: number };

export function DraftsView() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts");
      if (res.ok) setDrafts(((await res.json()) as { drafts: DraftRow[] }).drafts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (title.trim()) body.append("title", title.trim());

      const res = await fetch("/api/drafts", { method: "POST", body });
      if (!res.ok) throw new Error(await errorText(res));

      setFile(null);
      setTitle("");
      if (picker.current) picker.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/drafts/${id}`, { method: "DELETE" });
    await load();
  }

  /** For drafts uploaded before auto-naming, or when the first title missed. */
  async function rename(id: string) {
    setRenaming(id);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Черновики</h1>
          <p className="sub">
            Видео, которых ещё нет в Instagram. Загрузите файл — приложение расшифрует речь и
            соберёт бриф: вся статистика, транскрипты опубликованных роликов и темы комментариев
            плюс этот черновик. Один JSON, который можно отдать ИИ-агенту.
          </p>
        </div>
        <div className="row spacer">
          <a className="btn" href="/api/export?kind=brief">
            Бриф без черновика
          </a>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}

      <section className="card">
        <h2>Загрузить видео</h2>
        <div className="row">
          <input
            ref={picker}
            type="file"
            accept="video/*,audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            className="search"
            type="text"
            placeholder="Название — если пусто, придумаем по расшифровке"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
          <button className="primary" onClick={() => void upload()} disabled={busy || !file}>
            {busy ? <span className="spin" /> : null}
            {busy ? "Расшифровываем…" : "Загрузить и расшифровать"}
          </button>
        </div>
        {file ? (
          <p className="sub">
            {file.name} · {(file.size / MB).toFixed(1)} МБ
            {file.size > 24 * MB
              ? " — больше лимита OpenAI: приложение вырежет аудиодорожку, а если запись " +
                "длиннее ~50 минут, разрежет её на части по 10 минут и сошьёт транскрипт обратно"
              : ""}
          </p>
        ) : (
          <p className="sub">
            Сам видеофайл никуда не копируется — сохраняется только транскрипт.
          </p>
        )}
        {busy ? (
          <p className="sub">
            Загрузка и распознавание идут одним запросом — не закрывайте вкладку. Короткий
            ролик занимает меньше минуты; часовая запись режется на части и обрабатывается
            несколько минут. Распознавание стоит $0.006 за минуту аудио.
          </p>
        ) : null}
      </section>

      <AgentGuide />

      {loading ? <div className="card empty">Загружаем…</div> : null}

      {!loading && drafts.length === 0 ? (
        <div className="card empty">Черновиков пока нет.</div>
      ) : null}

      {drafts.map((draft) => {
        const expanded = open === draft.id;
        return (
          <section className="card" key={draft.id}>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0 }}>{draft.title}</h2>
                <p className="sub" style={{ margin: "4px 0 0" }}>
                  {formatDuration(draft.duration)} · {(draft.bytes / MB).toFixed(1)} МБ ·{" "}
                  {draft.chunks && draft.chunks > 1 ? `${draft.chunks} частей · ` : ""}
                  {draft.model}
                  {draft.language ? ` · ${draft.language}` : ""} · {formatDate(draft.createdAt)} ·{" "}
                  {formatNumber(draft.text.split(/\s+/).filter(Boolean).length)} слов
                </p>
              </div>
              <div className="row spacer">
                <a className="btn" href={`/api/export?kind=brief&draft=${draft.id}`}>
                  Бриф для агента
                </a>
                {draft.wordCount ? (
                  <a
                    className="btn"
                    href={`/api/drafts/${draft.id}/words`}
                    title={`${formatNumber(draft.wordCount)} слов с таймкодами начала и конца`}
                  >
                    Таймкоды слов
                  </a>
                ) : null}
                <button
                  onClick={() => void rename(draft.id)}
                  disabled={renaming === draft.id}
                  title="Придумать название заново по расшифровке"
                >
                  {renaming === draft.id ? <span className="spin" /> : null} Переназвать
                </button>
                <button onClick={() => void remove(draft.id)}>Удалить</button>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="ghost" onClick={() => setOpen(expanded ? null : draft.id)}>
                {expanded ? "скрыть транскрипт" : "показать транскрипт"}
              </button>
            </div>

            {expanded ? (
              <div className="transcript" style={{ marginTop: 10 }}>
                {draft.text || <span className="muted">Речь не распознана.</span>}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
