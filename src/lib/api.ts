import { NextResponse } from "next/server";
import { describeError, getAccount } from "./account";
import { fetchMedia, fetchOneMedia } from "./instagram";
import { paths, readJson, writeJson } from "./store";
import type { Account, Media, MediaIndex } from "./types";

export function fail(err: unknown): NextResponse {
  const { status, message } = describeError(err);
  return NextResponse.json({ error: message }, { status });
}

/**
 * Reads from disk only. Lets the UI keep working when the token has expired —
 * you can still browse and export everything already downloaded.
 */
export function cachedMediaIndex(): Promise<MediaIndex | null> {
  return readJson<MediaIndex>(paths.media);
}

export async function cachedMedia(mediaId: string): Promise<Media | null> {
  const index = await cachedMediaIndex();
  return index?.media.find((m) => m.id === mediaId) ?? null;
}

/** Cached post list, refreshed from Instagram when missing or when asked. */
export async function loadMediaIndex(account: Account, refresh: boolean): Promise<MediaIndex> {
  if (!refresh) {
    const cached = await cachedMediaIndex();
    if (cached && cached.igUserId === account.igUserId) return cached;
  }
  const index = await fetchMedia(account);
  await writeJson(paths.media, index);
  return index;
}

/**
 * A single post. Falls back to a direct API read so deep-linking to a post id
 * works before the list has ever been synced.
 */
export async function loadMedia(account: Account, mediaId: string, refresh = false): Promise<Media> {
  if (!refresh) {
    const hit = await cachedMedia(mediaId);
    if (hit) return hit;
  }
  return fetchOneMedia(account, mediaId);
}

export { getAccount };
