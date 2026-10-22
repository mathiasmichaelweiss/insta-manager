import OpenAI from "openai";
import { config } from "./config";

/** Shared text model for analysis jobs — topic clustering, draft titles. */
export const analysisModel = () => process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o-mini";

export function analysisClient(): OpenAI {
  if (!config.openaiKey) {
    throw new Error("OPENAI_API_KEY не задан — добавьте ключ в .env.local и перезапустите сервер.");
  }
  return new OpenAI({ apiKey: config.openaiKey });
}

const MAX_TITLE_LENGTH = 70;

/** First sentence, trimmed — used when the model is unavailable or unhelpful. */
function firstSentence(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;

  const end = flat.search(/[.!?]\s/);
  const candidate = end > 0 ? flat.slice(0, end) : flat;
  return candidate.length <= MAX_TITLE_LENGTH
    ? candidate
    : `${candidate.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Names a draft after what is actually said in it, so the list reads as topics
 * rather than as camera filenames like `1EF69A3E-DF7E-4568.MP4`.
 *
 * Never throws: a title is a convenience, and failing to invent one must not
 * cost the user an upload they already waited through transcription for.
 */
export async function suggestTitle(text: string): Promise<string | null> {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return null;

  try {
    const res = await analysisClient().chat.completions.create({
      model: analysisModel(),
      temperature: 0.2,
      max_tokens: 40,
      messages: [
        {
          role: "system",
          content:
            "Придумай короткое название для видео по его расшифровке: 3–7 слов, по-русски, " +
            "о чём ролик. Без кавычек, без точки в конце, без слов «видео» и «ролик». " +
            "Ответь только названием.",
        },
        { role: "user", content: source.slice(0, 1500) },
      ],
    });

    const title = res.choices[0]?.message?.content?.trim().replace(/^["«»']|["«»'.]+$/g, "");
    if (title && title.length <= MAX_TITLE_LENGTH) return title;
  } catch {
    // Fall through to the heuristic below.
  }

  return firstSentence(source);
}
