import { GraphError } from "./graph";
import type { SyncEvent, SyncOutcome } from "./types";

/**
 * Runs `worker` over every item and streams NDJSON progress, one `SyncEvent` per
 * line, so the UI shows a live counter instead of a frozen spinner.
 *
 * Shared by /api/sync/* (items are posts) and /api/analyze/* (items are batches
 * of comments). A failure on one item is reported and stepped over — it never
 * aborts the rest of the run.
 */
export function streamSync<T extends { id: string }>(
  request: Request,
  posts: T[],
  worker: (item: T) => Promise<SyncOutcome>,
  /**
   * How many items to process at once. Keep at 1 for Instagram-bound jobs —
   * its hourly call budget is small. Higher only for OpenAI-bound work.
   */
  concurrency = 1,
  /**
   * Called once the queue drains. Returning more items keeps the run going —
   * used for a second pass over whatever the first pass could not handle.
   * Return an empty array to finish.
   */
  expand?: () => Promise<T[]>,
  maxRounds = 2,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SyncEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      // Growable: `expand` can append a second pass once the first drains.
      const queue = [...posts];
      send({ type: "start", total: queue.length });

      let cursor = 0;
      let done = 0;
      let succeeded = 0;
      let skipped = 0;
      let failed = 0;
      let count = 0;
      let flagged = 0;
      let warning: string | undefined;
      let rateLimited = false;

      const runOne = async (media: T) => {
        try {
          const outcome = await worker(media);
          done += 1;

          if (outcome.skipped) {
            skipped += 1;
            send({ type: "skip", id: media.id, done, total: queue.length });
            return;
          }

          succeeded += 1;
          count += outcome.count;
          if (outcome.warning) {
            flagged += 1;
            warning ??= outcome.warning;
          }
          send({
            type: "progress",
            id: media.id,
            done,
            total: queue.length,
            count: outcome.count,
            flagged: Boolean(outcome.warning),
          });
        } catch (err) {
          done += 1;
          failed += 1;

          // Once the hourly budget is gone every remaining call fails the same
          // way. Stop and say so, instead of reporting three hundred identical
          // failures and looking like the job is broken.
          if (err instanceof GraphError && err.rateLimited) {
            rateLimited = true;
            warning ??=
              "Достигнут часовой лимит запросов Instagram — загрузка остановлена. " +
              "Уже загруженное сохранено; повторите через час, оно не будет перезапрашиваться.";
          }

          send({
            type: "error",
            id: media.id,
            done,
            total: queue.length,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      };

      const drain = async () => {
        const workers = Array.from(
          { length: Math.min(concurrency, queue.length - cursor) },
          async () => {
            while (cursor < queue.length && !request.signal.aborted && !rateLimited) {
              await runOne(queue[cursor++]);
            }
          },
        );
        await Promise.all(workers);
      };

      await drain();
      for (let round = 0; expand && round < maxRounds && !request.signal.aborted && !rateLimited; round++) {
        const more = await expand();
        if (more.length === 0) break;
        queue.push(...more);
        await drain();
      }

      send({
        type: "done",
        total: queue.length,
        succeeded,
        skipped,
        failed,
        count,
        flagged,
        warning,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Tell any proxy in front of us not to buffer, or progress arrives at the end.
      "X-Accel-Buffering": "no",
    },
  });
}
