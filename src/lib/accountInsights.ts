import { hostFor } from "./account";
import { graphGet } from "./graph";
import { readJson, writeJson } from "./store";
import type { Account, AccountInsights } from "./types";

const PATH = "account-insights.json";
/** Instagram serves at most 30 days of account insights per request. */
const WINDOW_DAYS = 30;

interface InsightRow {
  name: string;
  description?: string;
  values?: { value: number; end_time?: string }[];
}

const day = (iso?: string) => (iso ?? "").slice(0, 10);

/** Merges a fresh window into stored history, newer values winning per day. */
function mergeSeries(
  stored: { date: string; value: number }[],
  fresh: { date: string; value: number }[],
): { date: string; value: number }[] {
  const byDate = new Map(stored.map((point) => [point.date, point.value]));
  for (const point of fresh) byDate.set(point.date, point.value);
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function toSeries(rows: InsightRow[], name: string) {
  const row = rows.find((r) => r.name === name);
  return {
    description: row?.description,
    points: (row?.values ?? [])
      .filter((v) => v.end_time)
      .map((v) => ({ date: day(v.end_time), value: v.value })),
  };
}

/**
 * Pulls the last 30 days of account-level metrics and folds them into the
 * stored history, so running this regularly builds a series longer than the
 * 30-day window Instagram will serve in one go.
 */
export async function fetchAccountInsights(account: Account): Promise<AccountInsights> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - WINDOW_DAYS * 86_400;

  const res = await graphGet<{ data: InsightRow[] }>(
    `${account.igUserId}/insights`,
    { metric: "follower_count,reach", period: "day", since, until },
    account.accessToken,
    hostFor(account),
  );

  const followers = toSeries(res.data ?? [], "follower_count");
  const reach = toSeries(res.data ?? [], "reach");

  const stored = await readJson<AccountInsights>(PATH);
  const carryOver = stored?.igUserId === account.igUserId ? stored : null;

  const merged: AccountInsights = {
    igUserId: account.igUserId,
    fetchedAt: new Date().toISOString(),
    followerCount: mergeSeries(carryOver?.followerCount ?? [], followers.points),
    reach: mergeSeries(carryOver?.reach ?? [], reach.points),
    followerCountDescription: followers.description,
    notes: [
      "follower_count — новые подписчики за день по данным Instagram; отписки он не вычитает.",
      "Per-post метрика follows существует только для постов ленты и Stories. Для Reels " +
        "Instagram её не отдаёт, поэтому приписать подписки конкретному ролику нельзя.",
      `Instagram отдаёт максимум ${WINDOW_DAYS} дней за один запрос — история копится только ` +
        "с того момента, как вы начали её собирать.",
    ],
  };

  await writeJson(PATH, merged);
  return merged;
}

export function readAccountInsights(): Promise<AccountInsights | null> {
  return readJson<AccountInsights>(PATH);
}

/** Sum over the trailing `days` of a daily series. */
export function sumRecent(points: { date: string; value: number }[], days: number): number {
  return points.slice(-days).reduce((total, point) => total + point.value, 0);
}
