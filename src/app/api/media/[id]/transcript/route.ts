import { NextResponse } from "next/server";
import { fail, getAccount, loadMedia } from "@/lib/api";
import { paths, readJson, writeJson } from "@/lib/store";
import { TranscribeError, transcribeMedia } from "@/lib/transcribe";
import type { TranscriptFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Whisper on a long reel is slow; give it room.
export const maxDuration = 300;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const cached = await readJson<TranscriptFile>(paths.transcript(id));
    if (!cached) return NextResponse.json({ error: "Транскрипт ещё не создан" }, { status: 404 });
    return NextResponse.json(cached);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const force = new URL(request.url).searchParams.get("force") === "1";

    if (!force) {
      const cached = await readJson<TranscriptFile>(paths.transcript(id));
      if (cached) return NextResponse.json(cached);
    }

    const account = await getAccount();
    // media_url expires within hours, so never transcribe from the cached copy.
    const media = await loadMedia(account, id, true);
    const transcript = await transcribeMedia(media);
    await writeJson(paths.transcript(id), transcript);
    return NextResponse.json(transcript);
  } catch (err) {
    if (err instanceof TranscribeError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return fail(err);
  }
}
