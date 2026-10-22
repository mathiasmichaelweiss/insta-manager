import { NextResponse } from "next/server";
import { fail, getAccount, loadMediaIndex } from "@/lib/api";
import { config } from "@/lib/config";
import { fetchOneMedia } from "@/lib/instagram";
import { listIds, paths, readJson, writeJson } from "@/lib/store";
import { streamSync } from "@/lib/sync";
import { isVideo, transcribeMedia } from "@/lib/transcribe";
import type { Account, Media, TranscribePlan, TranscriptFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** whisper-1, USD per minute of audio. */
const USD_PER_MINUTE = 0.006;
/** Assumed clip length when nothing has been transcribed yet, in seconds. */
const FALLBACK_DURATION = 60;

async function videosToDo(account: Account, force: boolean) {
  const media = (await loadMediaIndex(account, true)).media;
  const videos = media.filter(isVideo);
  const done = new Set(await listIds("transcripts"));

  return {
    notVideo: media.length - videos.length,
    alreadyDone: videos.filter((m) => done.has(m.id)).length,
    todo: force ? videos : videos.filter((m) => !done.has(m.id)),
  };
}

/** Preflight: how many clips a run would process and roughly what it would cost. */
export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    const account = await getAccount();
    const { notVideo, alreadyDone, todo } = await videosToDo(account, force);

    // Estimate from what we already know about this account's clips rather than
    // a generic guess; with nothing on disk yet, fall back to a stated default.
    const samples = await Promise.all(
      (await listIds("transcripts")).map((id) => readJson<TranscriptFile>(paths.transcript(id))),
    );
    const durations = samples
      .map((s) => s?.duration)
      .filter((d): d is number => typeof d === "number" && d > 0);
    const average = durations.length
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : FALLBACK_DURATION;

    const estimatedMinutes = (todo.length * average) / 60;
    const plan: TranscribePlan = {
      pending: todo.length,
      alreadyDone,
      notVideo,
      estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
      estimatedUsd: Math.round(estimatedMinutes * USD_PER_MINUTE * 100) / 100,
      basedOnSamples: durations.length,
    };
    return NextResponse.json(plan);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";

  let account: Account;
  let posts: Media[];
  try {
    if (!config.openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY не задан — добавьте ключ в .env.local и перезапустите сервер." },
        { status: 400 },
      );
    }
    account = await getAccount();
    posts = (await videosToDo(account, force)).todo;
  } catch (err) {
    return fail(err);
  }

  return streamSync(
    request,
    posts,
    async (media) => {
      let file: TranscriptFile;
      try {
        file = await transcribeMedia(media);
      } catch (err) {
        // A long run can outlive the CDN links captured at the start, so refresh
        // this one post and try once more before giving up on it.
        const message = err instanceof Error ? err.message : String(err);
        if (!/скачать|media_url/i.test(message)) throw err;
        file = await transcribeMedia(await fetchOneMedia(account, media.id));
      }

      await writeJson(paths.transcript(media.id), file);
      return {
        count: 1,
        warning: file.text ? undefined : "В части роликов не распознана речь — транскрипт пуст.",
      };
    },
    // OpenAI-bound rather than Instagram-bound, so a few at a time is safe and
    // turns a ~40-minute run into a ~15-minute one.
    3,
  );
}
