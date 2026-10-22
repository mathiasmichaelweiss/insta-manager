import { listIds, paths, readJson } from "./store";
import type { InsightsFile, MetricsFile, PostMetrics, TranscriptFile } from "./types";

/**
 * Joins saved insights with saved transcripts and derives the ratios that make
 * posts comparable.
 *
 * Raw likes flatter old posts — they had more time to collect them. Everything
 * here is normalised by reach instead, so a post from last year and one from
 * yesterday can sit in the same sorted column.
 */

function ratio(part?: number, whole?: number): number | undefined {
  if (part === undefined || !whole) return undefined;
  return part / whole;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function loadMetrics(): Promise<MetricsFile> {
  const ids = await listIds("insights");
  const rows: PostMetrics[] = [];

  for (const id of ids) {
    const insights = await readJson<InsightsFile>(paths.insights(id));
    if (!insights) continue;

    const value = (name: string) => insights.metrics[name]?.value;
    const reach = value("reach");
    const totalInteractions = value("total_interactions");

    // Instagram reports watch time in milliseconds and never reports clip
    // length, so retention only exists once the post has been transcribed.
    const avgWatchMs = value("ig_reels_avg_watch_time");
    const transcript = await readJson<TranscriptFile>(paths.transcript(id));
    const durationSeconds = transcript?.duration;
    const avgWatchSeconds = avgWatchMs === undefined ? undefined : avgWatchMs / 1000;

    rows.push({
      mediaId: id,
      reach,
      views: value("views"),
      saved: value("saved"),
      shares: value("shares"),
      totalInteractions,
      skipRate: value("reels_skip_rate"),
      avgWatchSeconds,
      durationSeconds,
      retention: ratio(avgWatchSeconds, durationSeconds),
      er: ratio(totalInteractions, reach),
      savedPerReach: ratio(value("saved"), reach),
      sharesPerReach: ratio(value("shares"), reach),
      fetchedAt: insights.fetchedAt,
    });
  }

  const retentions = rows.map((r) => r.retention).filter((r): r is number => r !== undefined);

  return {
    count: rows.length,
    withRetention: retentions.length,
    medianReach: median(rows.map((r) => r.reach).filter((r): r is number => r !== undefined)),
    medianRetention: median(retentions),
    rows,
  };
}
