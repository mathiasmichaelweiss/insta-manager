import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { suggestTitle } from "@/lib/ai";
import { fail } from "@/lib/api";
import { listDrafts } from "@/lib/brief";
import { paths, writeJson } from "@/lib/store";
import { TranscribeError, transcribeLocalFile } from "@/lib/transcribe";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A multi-hour recording is transcribed in ten-minute parts; give it room.
export const maxDuration = 3600;

/** Formats OpenAI's transcription endpoint accepts. */
const ALLOWED = ["mp4", "mov", "webm", "mpeg", "mpga", "m4a", "mp3", "wav", "flac", "ogg", "oga"];

function extensionOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  // Anything unrecognised is relabelled mp4: ffmpeg sniffs the real container,
  // and a wrong-but-known extension beats one OpenAI refuses outright.
  return ALLOWED.includes(ext) ? ext : "mp4";
}

export async function GET() {
  try {
    // Word timings run to thousands of entries per draft and the list never shows
    // them; they are served on their own from /api/drafts/<id>/words.
    const drafts = (await listDrafts()).map(({ words, ...rest }) => ({
      ...rest,
      wordCount: words?.length,
    }));
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Accepts a video that has not been published yet, transcribes it, and keeps the
 * transcript next to the archive.
 *
 * The video itself is not stored — the user already has the file, and copying
 * gigabytes into `data/` would buy nothing.
 */
export async function POST(request: Request) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "insta-draft-"));

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    }

    const id = randomUUID();
    // OpenAI picks the decoder from the file extension, so keep a known one and
    // never let a user-supplied name reach the filesystem.
    const source = path.join(dir, `source.${extensionOf(file.name)}`);
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(source));

    const result = await transcribeLocalFile(source, dir, id, { words: true });

    // A camera filename tells you nothing in a list; name the draft after what
    // is actually said in it unless the user typed something better.
    const provided = String(form.get("title") || "").trim();
    const title = provided || (await suggestTitle(result.text)) || file.name;

    const draft: Draft = {
      id,
      title,
      fileName: file.name,
      bytes: file.size,
      createdAt: new Date().toISOString(),
      notes: String(form.get("notes") || "").trim() || undefined,
      model: result.model,
      language: result.language,
      duration: result.duration,
      chunks: result.chunks,
      text: result.text,
      segments: result.segments,
      words: result.words,
    };

    await writeJson(paths.draft(id), draft);
    return NextResponse.json({ draft });
  } catch (err) {
    if (err instanceof TranscribeError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return fail(err);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
