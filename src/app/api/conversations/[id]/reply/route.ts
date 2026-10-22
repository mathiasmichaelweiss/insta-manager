import { NextResponse } from "next/server";
import { fail, getAccount } from "@/lib/api";
import { REPLY_WINDOW_MS, sendMessage, summarise, syncConversation } from "@/lib/messages";
import { paths, readJson } from "@/lib/store";
import type { ConversationFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a Direct reply — a real write to a real person's inbox. The UI confirms
 * before calling this; the checks here are the last line, not the only one.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { text } = (await request.json()) as { text?: string };
    const message = text?.trim();
    if (!message) {
      return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
    }

    const file = await readJson<ConversationFile>(paths.conversation(id));
    if (!file) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });

    const account = await getAccount();
    const recipient = file.counterpart?.id;
    if (!recipient) {
      return NextResponse.json(
        { error: "Не удалось определить получателя — в диалоге нет собеседника." },
        { status: 422 },
      );
    }

    // Meta closes the window 24h after their last message. Checking here turns a
    // confusing API rejection into a clear explanation.
    const summary = summarise(file, account.igUserId);
    if (!summary.replyWindowOpen) {
      return NextResponse.json(
        {
          error:
            `Окно ответа закрыто: Instagram разрешает писать в течение ${REPLY_WINDOW_MS / 3_600_000} ` +
            "часов после последнего сообщения собеседника. Ответить можно только из приложения Instagram.",
        },
        { status: 422 },
      );
    }

    const sent = await sendMessage(account, recipient, message);

    // Refetch so the sent message appears in the stored thread straight away.
    await syncConversation(
      account,
      { id: file.id, updated_time: new Date().toISOString() },
      true,
    ).catch(() => undefined);

    return NextResponse.json({ ok: true, messageId: sent.message_id });
  } catch (err) {
    return fail(err);
  }
}
