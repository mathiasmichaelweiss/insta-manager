import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import OpenAI, { toFile } from "openai";
import { config } from "./config";
import type { Media, TranscriptFile, TranscriptSegment, TranscriptWord } from "./types";

const run = promisify(execFile);

/** OpenAI's audio endpoint caps uploads at 25 MB; stay under it. */
const UPLOAD_LIMIT = 24 * 1024 * 1024;

export class TranscribeError extends Error {}

export function isVideo(media: Media): boolean {
  return media.media_type === "VIDEO" || media.media_product_type === "REELS";
}

async function hasFfmpeg(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, target: string): Promise<number> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) {
    throw new TranscribeError(
      `Не удалось скачать видео (HTTP ${res.status}). ` +
        "Ссылки media_url живут недолго — обновите список постов и попробуйте снова.",
    );
  }
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(source, createWriteStream(target));
  return (await fs.stat(target)).size;
}

/** Strips the video track: same speech, a fraction of the bytes. */
async function toAudioOnly(input: string, output: string): Promise<void> {
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", output]);
}

/**
 * Chunk length for recordings too long to send in one piece.
 *
 * At the mono 64 kbps we re-encode to, ten minutes is roughly 5 MB — well under
 * the 25 MB cap, with room for the bitrate to wander on dense audio.
 */
const CHUNK_SECONDS = 600;

async function probeDuration(file: string): Promise<number | undefined> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cuts an already-encoded mp3 into fixed-length parts. Uses stream copy, so it
 * costs a file read rather than a second encode.
 */
async function splitAudio(input: string, dir: string): Promise<string[]> {
  const partsDir = path.join(dir, "parts");
  await fs.mkdir(partsDir, { recursive: true });

  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(CHUNK_SECONDS),
    "-reset_timestamps",
    "1",
    path.join(partsDir, "part-%03d.mp3"),
  ]);

  const names = (await fs.readdir(partsDir)).filter((n) => /^part-\d+\.mp3$/.test(n)).sort();
  if (names.length === 0) throw new TranscribeError("Не удалось разрезать запись на части.");
  return names.map((n) => path.join(partsDir, n));
}

export async function transcribeMedia(media: Media): Promise<TranscriptFile> {
  if (!config.openaiKey) {
    throw new TranscribeError("OPENAI_API_KEY не задан — добавьте ключ в .env.local и перезапустите dev-сервер.");
  }
  if (!isVideo(media)) {
    throw new TranscribeError("Этот пост не является видео — транскрибировать нечего.");
  }
  if (!media.media_url) {
    throw new TranscribeError(
      "У поста нет media_url. Обновите список постов — ссылки Instagram выдаёт временные.",
    );
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "insta-manager-"));
  const videoPath = path.join(dir, `${media.id}.mp4`);

  try {
    const bytes = await download(media.media_url, videoPath);
    const result = await transcribeLocalFile(videoPath, dir, media.id);

    return {
      mediaId: media.id,
      permalink: media.permalink,
      transcribedAt: new Date().toISOString(),
      ...result,
      source: { mediaUrl: media.media_url, bytes, transcodedToAudio: result.transcodedToAudio },
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export interface LocalTranscript {
  model: string;
  language?: string;
  duration?: number;
  text: string;
  segments: TranscriptSegment[];
  /** Empty unless the model was whisper-1 — the only one that times words. */
  words: TranscriptWord[];
  transcodedToAudio: boolean;
  /** How many requests the recording was split across. 1 = sent whole. */
  chunks: number;
}

/**
 * Whisper reports the detected language by name but only accepts ISO-639-1 on
 * input. Pinning the language for later chunks stops a quiet stretch in the
 * middle of a recording from being "detected" as some other language.
 */
const LANGUAGE_CODES: Record<string, string> = {
  russian: "ru",
  german: "de",
  english: "en",
  ukrainian: "uk",
  polish: "pl",
  turkish: "tr",
};

interface OneResult {
  text: string;
  language?: string;
  duration?: number;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
}

async function transcribeOne(
  file: string,
  model: string,
  hints: { language?: string; prompt?: string } = {},
): Promise<OneResult> {
  // Only whisper-1 returns timestamped segments; newer models reject verbose_json.
  const wantsSegments = model === "whisper-1";
  const upload = await toFile(createReadStream(file), path.basename(file));

  const result = (await new OpenAI({ apiKey: config.openaiKey }).audio.transcriptions.create({
    file: upload,
    model,
    response_format: wantsSegments ? "verbose_json" : "json",
    ...(wantsSegments ? { timestamp_granularities: ["segment", "word"] as const } : {}),
    ...(hints.language ? { language: hints.language } : {}),
    ...(hints.prompt ? { prompt: hints.prompt } : {}),
  })) as {
    text: string;
    language?: string;
    duration?: number;
    segments?: { id: number; start: number; end: number; text: string }[];
    words?: { word: string; start: number; end: number }[];
  };

  return {
    text: result.text?.trim() ?? "",
    language: result.language,
    duration: result.duration,
    segments: (result.segments ?? []).map((seg) => ({
      id: seg.id,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    })),
    words: (result.words ?? []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end })),
  };
}

/**
 * Transcribes media already on disk. Shared by published posts (downloaded from
 * Instagram) and by drafts the user uploads before publishing.
 *
 * Pass `words: true` to guarantee per-word timestamps (forces whisper-1).
 *
 * Recordings longer than the upload cap allows are cut into parts and stitched
 * back together: segment timestamps are shifted by each part's real duration, so
 * the merged timeline stays true rather than assuming every cut is exact.
 *
 * `workDir` is where re-encoded audio and parts land; the caller cleans it up.
 */
export async function transcribeLocalFile(
  filePath: string,
  workDir: string,
  name: string,
  opts: { words?: boolean } = {},
): Promise<LocalTranscript> {
  if (!config.openaiKey) {
    throw new TranscribeError(
      "OPENAI_API_KEY не задан — добавьте ключ в .env.local и перезапустите dev-сервер.",
    );
  }

  // Word timings exist only on whisper-1, so a caller that needs them gets it
  // regardless of the configured model.
  const model = opts.words ? "whisper-1" : config.transcribeModel;
  const bytes = (await fs.stat(filePath)).size;
  let uploadPath = filePath;
  let transcoded = false;

  if (bytes > UPLOAD_LIMIT) {
    if (!(await hasFfmpeg())) {
      throw new TranscribeError(
        `Файл весит ${(bytes / 1024 / 1024).toFixed(1)} МБ, лимит OpenAI — 25 МБ. ` +
          "Установите ffmpeg (brew install ffmpeg), чтобы приложение сжимало и при нужде " +
          "разрезало запись на части.",
      );
    }
    uploadPath = path.join(workDir, `${name}.mp3`);
    await toAudioOnly(filePath, uploadPath);
    transcoded = true;
  }

  // Small enough after (optional) compression — one request, done.
  if ((await fs.stat(uploadPath)).size <= UPLOAD_LIMIT) {
    const single = await transcribeOne(uploadPath, model);
    return { model, ...single, transcodedToAudio: transcoded, chunks: 1 };
  }

  const parts = await splitAudio(uploadPath, workDir);
  const texts: string[] = [];
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];
  let offset = 0;
  let language: string | undefined;

  for (const part of parts) {
    const result = await transcribeOne(part, model, {
      language: language ? LANGUAGE_CODES[language.toLowerCase()] : undefined,
      // The tail of the previous part gives the model context across the cut,
      // which keeps names and terms consistent and rescues split words.
      prompt: texts.at(-1)?.slice(-200),
    });

    language ??= result.language;
    for (const seg of result.segments) {
      segments.push({
        id: segments.length,
        start: seg.start + offset,
        end: seg.end + offset,
        text: seg.text,
      });
    }
    for (const w of result.words) {
      words.push({ word: w.word, start: w.start + offset, end: w.end + offset });
    }
    if (result.text) texts.push(result.text);

    // Stream-copy segmenting lands near the requested length, not exactly on it.
    offset += (await probeDuration(part)) ?? result.duration ?? CHUNK_SECONDS;
  }

  return {
    model,
    language,
    duration: offset,
    text: texts.join(" ").trim(),
    segments,
    words,
    transcodedToAudio: transcoded,
    chunks: parts.length,
  };
}
