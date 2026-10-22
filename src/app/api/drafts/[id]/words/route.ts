import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { paths, readJson } from "@/lib/store";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-word timestamps of a draft as a downloadable JSON file. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const draft = await readJson<Draft>(paths.draft(id));
    if (!draft) return NextResponse.json({ error: "Черновик не найден" }, { status: 404 });
    if (!draft.words?.length) {
      return NextResponse.json(
        { error: "У этого черновика нет таймкодов слов — загрузите видео заново." },
        { status: 404 },
      );
    }

    const body = {
      draftId: draft.id,
      title: draft.title,
      fileName: draft.fileName,
      language: draft.language,
      duration: draft.duration,
      model: draft.model,
      words: draft.words,
    };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="words-${draft.id.slice(0, 8)}.json"`,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
