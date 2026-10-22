import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { buildBrief } from "@/lib/brief";
import { listIds, paths, readJson } from "@/lib/store";
import type {
  CommentsFile,
  ConversationFile,
  InsightsFile,
  MediaIndex,
  TopicsFile,
  TranscriptFile,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = [
  "media",
  "comments",
  "insights",
  "transcript",
  "post",
  "all-comments",
  "all-insights",
  "all-transcripts",
  "topics",
  "dm-topics",
  "all-messages",
  "brief",
] as const;
type Kind = (typeof KINDS)[number];

/** Kinds that bundle a whole directory rather than one post. */
const BULK: Record<string, boolean> = {
  media: true,
  "all-comments": true,
  "all-insights": true,
  "all-transcripts": true,
  topics: true,
  "dm-topics": true,
  "all-messages": true,
  brief: true,
};

function download(filename: string, payload: unknown) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Reads every JSON file in one of the data subdirectories, skipping unreadable ones. */
async function readAll<T extends object>(
  dir: string,
  toPath: (id: string) => string,
): Promise<T[]> {
  const found: T[] = [];
  for (const id of await listIds(dir)) {
    const file = await readJson<T>(toPath(id));
    if (file) found.push(file);
  }
  return found;
}

const missing = (what: string) =>
  NextResponse.json({ error: `${what} ещё не загружены — сначала нажмите «Загрузить».` }, { status: 404 });

/** Serves saved JSON straight from disk as a file download. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") as Kind | null;
    const id = params.get("id") ?? "";
    const stamp = new Date().toISOString().slice(0, 10);

    if (!kind || !KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `Неизвестный kind. Доступны: ${KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!BULK[kind] && !id) {
      return NextResponse.json({ error: "Не передан id поста" }, { status: 400 });
    }

    switch (kind) {
      case "media": {
        const data = await readJson<MediaIndex>(paths.media);
        return data ? download(`posts-${stamp}.json`, data) : missing("Посты");
      }

      case "dm-topics": {
        const data = await readJson<TopicsFile>("dm-topics.json");
        return data ? download(`dm-topics-${stamp}.json`, data) : missing("Темы директа");
      }

      case "all-messages": {
        const threads = await readAll<ConversationFile>("conversations", paths.conversation);
        return download(`messages-${stamp}.json`, {
          exportedAt: new Date().toISOString(),
          conversations: threads.length,
          totalMessages: threads.reduce((sum, t) => sum + t.messageCount, 0),
          data: threads,
        });
      }

      case "topics": {
        const data = await readJson<TopicsFile>(paths.topics);
        return data ? download(`topics-${stamp}.json`, data) : missing("Темы комментариев");
      }

      // Everything an outside AI agent needs to judge a draft, in one file.
      case "brief": {
        const draftId = params.get("draft") ?? undefined;
        // ?dm=0 leaves private correspondence out of the bundle.
        const brief = await buildBrief(draftId, params.get("dm") !== "0");
        const name = draftId ? `brief-draft-${draftId.slice(0, 8)}` : `brief-${stamp}`;
        return download(`${name}.json`, brief);
      }

      case "comments": {
        const data = await readJson<CommentsFile>(paths.comments(id));
        return data ? download(`comments-${id}.json`, data) : missing("Комментарии");
      }

      case "insights": {
        const data = await readJson<InsightsFile>(paths.insights(id));
        return data ? download(`insights-${id}.json`, data) : missing("Статистика");
      }

      case "transcript": {
        const data = await readJson<TranscriptFile>(paths.transcript(id));
        return data ? download(`transcript-${id}.json`, data) : missing("Транскрипт");
      }

      case "post": {
        const index = await readJson<MediaIndex>(paths.media);
        const [comments, insights, transcript] = await Promise.all([
          readJson<CommentsFile>(paths.comments(id)),
          readJson<InsightsFile>(paths.insights(id)),
          readJson<TranscriptFile>(paths.transcript(id)),
        ]);
        return download(`post-${id}.json`, {
          exportedAt: new Date().toISOString(),
          media: index?.media.find((m) => m.id === id) ?? null,
          insights,
          comments,
          transcript,
        });
      }

      case "all-comments": {
        const posts = await readAll<CommentsFile>("comments", paths.comments);
        return download(`all-comments-${stamp}.json`, {
          exportedAt: new Date().toISOString(),
          posts: posts.length,
          totalComments: posts.reduce((sum, p) => sum + p.totalWithReplies, 0),
          data: posts,
        });
      }

      case "all-insights": {
        const posts = await readAll<InsightsFile>("insights", paths.insights);
        return download(`all-insights-${stamp}.json`, {
          exportedAt: new Date().toISOString(),
          posts: posts.length,
          data: posts,
        });
      }

      case "all-transcripts": {
        const posts = await readAll<TranscriptFile>("transcripts", paths.transcript);
        return download(`all-transcripts-${stamp}.json`, {
          exportedAt: new Date().toISOString(),
          posts: posts.length,
          totalMinutes:
            Math.round((posts.reduce((sum, p) => sum + (p.duration ?? 0), 0) / 60) * 10) / 10,
          data: posts,
        });
      }
    }
  } catch (err) {
    return fail(err);
  }
}
