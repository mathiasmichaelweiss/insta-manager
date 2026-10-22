import { NextResponse } from "next/server";
import { suggestTitle } from "@/lib/ai";
import { fail } from "@/lib/api";
import { paths, readJson, removeJson, writeJson } from "@/lib/store";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const draft = await readJson<Draft>(paths.draft(id));
    if (!draft) return NextResponse.json({ error: "Черновик не найден" }, { status: 404 });
    return NextResponse.json(draft);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Renames a draft: either to a title the user typed, or to one derived from the
 * transcript. Lets drafts uploaded before auto-naming existed be fixed in place.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const draft = await readJson<Draft>(paths.draft(id));
    if (!draft) return NextResponse.json({ error: "Черновик не найден" }, { status: 404 });

    const body = (await request.json()) as { title?: string; regenerate?: boolean };
    const title = body.regenerate ? await suggestTitle(draft.text) : body.title?.trim();
    if (!title) {
      return NextResponse.json(
        { error: "Не удалось придумать название — речь в ролике не распознана." },
        { status: 422 },
      );
    }

    const updated: Draft = { ...draft, title };
    await writeJson(paths.draft(id), updated);
    return NextResponse.json({ draft: updated });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await removeJson(paths.draft(id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
