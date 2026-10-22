import { NextResponse } from "next/server";
import { fail, getAccount } from "@/lib/api";
import { deepenConversation } from "@/lib/messages";
import { paths, readJson } from "@/lib/store";
import type { ConversationFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const file = await readJson<ConversationFile>(paths.conversation(id));
    if (!file) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });

    // The bulk sync only stores recent messages; opening a thread is when the
    // rest is worth a call. Failure here is not fatal — show what we have.
    if (new URL(request.url).searchParams.get("full") === "1" && file.partial) {
      const full = await deepenConversation(await getAccount(), file).catch(() => file);
      return NextResponse.json(full);
    }
    return NextResponse.json(file);
  } catch (err) {
    return fail(err);
  }
}
