"use client";

import { useCallback, useEffect, useState } from "react";
import { errorText, formatDate, formatNumber } from "@/lib/format";
import type { Account, AuthMode } from "@/lib/types";

type PublicAccount = Omit<Account, "accessToken">;

interface Info {
  account: PublicAccount | null;
  igOauthAvailable: boolean;
  fbOauthAvailable: boolean;
  openaiConfigured: boolean;
  graphVersion: string;
  envTokenPresent: boolean;
}

const MODE_LABEL: Record<AuthMode, string> = {
  instagram: "Instagram API с входом через Instagram (graph.instagram.com)",
  facebook: "Instagram API с входом через Facebook (graph.facebook.com)",
};

export function SettingsView() {
  const [info, setInfo] = useState<Info | null>(null);
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<AuthMode | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/account");
    if (res.ok) setInfo((await res.json()) as Info);
  }, []);

  useEffect(() => {
    void load();
    // The OAuth callback redirects back here with the result in the query string.
    const params = new URLSearchParams(window.location.search);
    if (params.get("ok")) setOk(params.get("ok"));
    if (params.get("error")) setError(params.get("error"));
    if (params.size) window.history.replaceState({}, "", "/settings");
  }, [load]);

  async function post(url: string, body?: unknown, done?: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(await errorText(res));
      if (done) setOk(done);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const connected = await post(
      "/api/account",
      { accessToken: token.trim(), mode: mode === "auto" ? undefined : mode },
      "Аккаунт подключён.",
    );
    if (connected) setToken("");
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fetch("/api/account", { method: "DELETE" });
      setOk("Аккаунт отключён. Сохранённые JSON-файлы в data/ остались на месте.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const account = info?.account;
  const expiresIn = account?.expiresAt
    ? Math.round((account.expiresAt * 1000 - Date.now()) / 86_400_000)
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <p className="sub">Подключение Instagram-аккаунта и состояние окружения</p>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {ok ? <div className="notice ok">{ok}</div> : null}

      <section className="card">
        <h2>Аккаунт</h2>
        {account ? (
          <>
            <dl className="meta-list">
              <dt>Instagram</dt>
              <dd>
                {account.username ? `@${account.username}` : "—"}{" "}
                <span className="mono muted">{account.igUserId}</span>
              </dd>
              <dt>Режим API</dt>
              <dd>{MODE_LABEL[account.mode]}</dd>
              {account.accountType ? (
                <>
                  <dt>Тип аккаунта</dt>
                  <dd>{account.accountType}</dd>
                </>
              ) : null}
              {account.followersCount !== undefined ? (
                <>
                  <dt>Подписчики</dt>
                  <dd>{formatNumber(account.followersCount)}</dd>
                </>
              ) : null}
              {account.mediaCount !== undefined ? (
                <>
                  <dt>Постов</dt>
                  <dd>{formatNumber(account.mediaCount)}</dd>
                </>
              ) : null}
              {account.pageId ? (
                <>
                  <dt>Страница FB</dt>
                  <dd>
                    {account.pageName ?? "—"} <span className="mono muted">{account.pageId}</span>
                  </dd>
                </>
              ) : null}
              <dt>Источник маркера</dt>
              <dd>{account.tokenSource}</dd>
              <dt>Маркер истекает</dt>
              <dd>
                {account.expiresAt
                  ? `${formatDate(new Date(account.expiresAt * 1000).toISOString())}${
                      expiresIn !== null ? ` (через ${expiresIn} дн.)` : ""
                    }`
                  : "неизвестно — маркер из дашборда живёт 60 дней с момента выпуска"}
              </dd>
              <dt>Подключён</dt>
              <dd>{formatDate(account.savedAt)}</dd>
            </dl>
            <div className="row" style={{ marginTop: 14 }}>
              {account.mode === "instagram" ? (
                <button
                  onClick={() => void post("/api/account/refresh", undefined, "Маркер продлён на 60 дней.")}
                  disabled={busy}
                  title="Сбрасывает срок жизни маркера на 60 дней. Работает, если маркеру уже больше 24 часов."
                >
                  {busy ? <span className="spin" /> : null} Продлить маркер на 60 дней
                </button>
              ) : null}
              <button onClick={() => void disconnect()} disabled={busy}>
                Отключить
              </button>
            </div>
          </>
        ) : (
          <p className="sub">Аккаунт не подключён.</p>
        )}
      </section>

      <section className="card">
        <h2>Маркер доступа</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          В дашборде приложения: <b>API setup with Instagram business login</b> → шаг 2
          «Сгенерируйте маркеры доступа» → добавьте свой аккаунт и нажмите Generate token.
          Такой маркер живёт 60 дней. Вставьте его сюда — приложение само определит режим API
          и сохранит аккаунт в <code>data/account.json</code>.
        </p>
        <textarea
          rows={4}
          style={{ width: "100%" }}
          placeholder="IGAA… (Instagram) или EAAG… (Facebook)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <select value={mode} onChange={(e) => setMode(e.target.value as AuthMode | "auto")}>
            <option value="auto">Определить автоматически</option>
            <option value="instagram">Instagram login</option>
            <option value="facebook">Facebook login</option>
          </select>
          <button className="primary" onClick={() => void connect()} disabled={busy || !token.trim()}>
            {busy ? <span className="spin" /> : null} Подключить
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Разрешения приложения</h2>
        <p className="sub">
          Проверьте в разделе «Разрешения и функции». Для этого приложения нужны:
        </p>
        <dl className="meta-list" style={{ marginTop: 10 }}>
          <dt className="mono">instagram_business_basic</dt>
          <dd>посты и метаданные</dd>
          <dt className="mono">instagram_business_manage_comments</dt>
          <dd>комментарии и ответы</dd>
          <dt className="mono">instagram_business_manage_insights</dt>
          <dd>статистика поста</dd>
        </dl>
        <p className="sub" style={{ marginTop: 10 }}>
          После добавления разрешения маркер доступа нужно <b>сгенерировать заново</b> — старый
          не получит новых прав. <code>instagram_business_manage_messages</code> этому приложению
          не нужен.
        </p>
      </section>

      <section className="card">
        <h2>Режим приложения</h2>
        <p className="sub">
          Для комментариев приложение в дашборде должно быть переключено в режим <b>Live</b>.
          В режиме Development Instagram отдаёт только ваши собственные данные: посты и
          статистика приходят, а комментарии написаны другими людьми — API возвращает пустой
          список без ошибки.
        </p>
        <p className="sub" style={{ marginTop: 10 }}>
          Live не публикует приложение и не требует App Review. При уровне Standard Access
          пользоваться им можете только вы, и оно продолжает работать на localhost.
          Для переключения нужен только URL политики конфиденциальности — готовый текст
          лежит в <code>docs/privacy-policy.md</code>, его достаточно выложить публичным Gist.
        </p>
      </section>

      <section className="card">
        <h2>Вход по OAuth</h2>
        {info?.igOauthAvailable || info?.fbOauthAvailable ? (
          <div className="row">
            {info.igOauthAvailable ? (
              <a className="btn" href="/api/auth/login?mode=instagram">
                Войти через Instagram
              </a>
            ) : null}
            {info.fbOauthAvailable ? (
              <a className="btn" href="/api/auth/login?mode=facebook">
                Войти через Facebook
              </a>
            ) : null}
          </div>
        ) : (
          <p className="sub">
            Не заданы <code>IG_APP_ID</code>/<code>IG_APP_SECRET</code> (или
            <code> FB_APP_ID</code>/<code>FB_APP_SECRET</code>) в <code>.env.local</code>.
            Для личного использования это не нужно — достаточно вставить маркер выше.
          </p>
        )}
        <p className="sub" style={{ marginTop: 10 }}>
          Instagram требует <b>https</b> в Redirect URI, поэтому вход через Instagram на
          <code> http://localhost</code> работать не будет. Это ещё одна причина пользоваться
          маркером из дашборда.
        </p>
      </section>

      <section className="card">
        <h2>Окружение</h2>
        <dl className="meta-list">
          <dt>Версия API</dt>
          <dd className="mono">{info?.graphVersion ?? "—"}</dd>
          <dt>OPENAI_API_KEY</dt>
          <dd>{info?.openaiConfigured ? "задан" : "не задан — транскрипция недоступна"}</dd>
          <dt>IG_ACCESS_TOKEN</dt>
          <dd>{info?.envTokenPresent ? "задан в .env" : "не задан"}</dd>
        </dl>
      </section>
    </>
  );
}
