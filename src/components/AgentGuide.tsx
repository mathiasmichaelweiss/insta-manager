"use client";

import { useState } from "react";

/**
 * Ready-made prompts for working with the brief.
 *
 * They name the actual fields in the JSON (`draft.hook`, `retention`,
 * `commentTopics`, `benchmarks`) — an agent told which field to look at cites
 * the data instead of inventing plausible-sounding advice. Every prompt also
 * points at `dataNotes`, because the brief deliberately omits metrics that do
 * not exist and a missing field must not be read as a zero.
 */
const PROMPTS: { id: string; title: string; when: string; text: string }[] = [
  {
    id: "judge",
    title: "Оценить черновик перед публикацией",
    when: "Основной сценарий: есть новый ролик, надо понять, взлетит ли он.",
    text: `Ты — редактор Reels-канала. Во вложенном JSON: метрики всех моих опубликованных роликов, их полные транскрипты и хуки, темы комментариев аудитории и транскрипт нового ролика в поле draft.

Сначала прочитай dataNotes — там сказано, каких метрик не существует. Отсутствующее поле означает «метрики нет», а не ноль.

Сделай по порядку:
1. Раздели posts на верхнюю и нижнюю треть по retention. Найди, чем отличаются их hook и transcript: структура первых секунд, обещание зрителю, конкретика, длина. Опирайся на текст, а не на догадки.
2. Оцени draft.hook по найденным признакам. Дай прогноз: в какую треть попадёт и почему.
3. Предложи 3 переписанных варианта первых 5 секунд — каждый в стиле, который у меня уже работал.
4. Проверь, пересекается ли тема черновика с commentTopics. Если да — укажи название темы и questionCount.

Каждое утверждение подкрепляй полями из JSON с числами. Ничего не выдумывай.`,
  },
  {
    id: "ideas",
    title: "Найти темы для новых роликов",
    when: "Когда нужен список тем с подтверждённым спросом.",
    text: `Во вложенном JSON есть commentTopics — темы комментариев моей аудитории: count (сколько комментариев), questionCount (сколько из них вопросы), postCount (под сколькими постами встречается) и примеры формулировок.

Отбери 10 тем для новых роликов. Приоритет — темы, где много вопросов, но мало постов: это недообслуженный спрос.

Для каждой темы дай:
- вопрос словами самой аудитории (возьми из examples);
- почему тема недообслужена — с числами questionCount и postCount;
- вариант хука на 5 секунд.

Отсортируй по потенциалу и объясни порядок.`,
  },
  {
    id: "patterns",
    title: "Понять, что общего у сработавших роликов",
    when: "Разбор всего архива: какие правила вывести на будущее.",
    text: `Проанализируй массив posts во вложенном JSON. У каждого поста есть hook (первые секунды речи), transcript (полная расшифровка) и метрики: reach, retention, er, savedPerReach, sharesPerReach, skipRate.

Сначала прочитай dataNotes и benchmarks — сравнивай посты с медианами, а не между собой напрямую.

Раздели ролики на сработавшие и провальные по retention и savedPerReach относительно benchmarks. Найди закономерности в hook и transcript: как построены первые секунды, есть ли обещание, вопрос, конфликт, цифра, личная история.

Сформулируй 7 правил для моих будущих роликов. Каждое правило подкрепи двумя примерами из моих же роликов — с id и цифрами.

Отдельно назови приёмы, которые стабильно проваливаются.`,
  },
  {
    id: "duplicate",
    title: "Проверить, не снимал ли я это раньше",
    when: "Перед съёмкой: не повтор ли тема и как зашёл прошлый раз.",
    text: `Во вложенном JSON — все мои опубликованные ролики с полными транскриптами (posts[].transcript) и новый черновик (draft.transcript).

Найди среди опубликованных те, что пересекаются с черновиком по теме. Для каждого совпадения укажи: id, дату, о чём был ролик, reach и retention.

Затем ответь:
- это дубль или новый угол на ту же тему;
- если тема уже была и сработала — что стоит повторить;
- если была и провалилась — что именно не сработало, судя по транскрипту;
- какой угол ещё не раскрыт, судя по commentTopics.`,
  },
];

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      // Clipboard access needs a secure context; over plain http it can refuse.
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button onClick={() => void copy()}>
      {state === "ok" ? "Скопировано" : state === "fail" ? "Выделите вручную" : "Копировать"}
    </button>
  );
}

export function AgentGuide() {
  // The main scenario starts open, so it is obvious what a prompt looks like.
  const [open, setOpen] = useState<string | null>(PROMPTS[0].id);

  return (
    <>
      <section className="card">
        <h2>Как отдать бриф агенту</h2>
        <ol className="steps">
          <li>
            Загрузите видео выше — приложение расшифрует речь. Если оценить нужно ещё не снятый
            ролик, загружать нечего: берите «Бриф без черновика» и вставляйте сценарий текстом.
          </li>
          <li>
            Нажмите <b>«Бриф для агента»</b> у нужного черновика. Скачается один JSON: медианы
            аккаунта, все посты с метриками и транскриптами, темы комментариев и сам черновик.
          </li>
          <li>
            Приложите файл к диалогу с ИИ-агентом и вставьте один из промптов ниже. Файл весит
            около 220 КБ — это примерно 50 тысяч токенов, помещается в контекст целиком.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Готовые промпты</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Написаны под структуру брифа: называют конкретные поля, чтобы агент опирался на ваши
          цифры, а не сочинял правдоподобное.
        </p>

        {PROMPTS.map((prompt) => {
          const expanded = open === prompt.id;
          return (
            <div className="prompt-row" key={prompt.id}>
              <div className="row">
                <div style={{ minWidth: 0 }}>
                  <b>{prompt.title}</b>
                  <p className="sub" style={{ margin: "2px 0 0" }}>
                    {prompt.when}
                  </p>
                </div>
                <div className="row spacer">
                  <button className="ghost" onClick={() => setOpen(expanded ? null : prompt.id)}>
                    {expanded ? "скрыть" : "показать"}
                  </button>
                  <CopyButton text={prompt.text} />
                </div>
              </div>
              {expanded ? <pre className="prompt">{prompt.text}</pre> : null}
            </div>
          );
        })}
      </section>

      <section className="card card-soft">
        <h2>Что внутри брифа</h2>
        <dl className="meta-list">
          <dt className="mono">account</dt>
          <dd>подписчики и прирост за 7 и 30 дней по аккаунту</dd>
          <dt className="mono">benchmarks</dt>
          <dd>медианы охвата, досмотра, ER и сохранений — с чем сравнивать пост</dd>
          <dt className="mono">posts[]</dt>
          <dd>каждый пост: метрики, hook (первые 5 секунд речи) и полный транскрипт, по убыванию охвата</dd>
          <dt className="mono">commentTopics[]</dt>
          <dd>темы комментариев: сколько всего, сколько вопросов, под сколькими постами, примеры</dd>
          <dt className="mono">draft</dt>
          <dd>черновик: название, длительность, хук и транскрипт</dd>
          <dt className="mono">dataNotes</dt>
          <dd>оговорки о данных — их агент должен прочитать первыми</dd>
        </dl>
        <p className="sub" style={{ marginTop: 12 }}>
          Главная оговорка: подписки нельзя приписать конкретному Reels — Instagram не отдаёт для
          них метрику follows. Отсутствие поля в брифе значит «метрики не существует», а не ноль;
          если агент начнёт делать выводы из нулей, укажите ему на <code>dataNotes</code>.
        </p>
      </section>
    </>
  );
}
