import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

/**
 * Flat-file JSON store under DATA_DIR:
 *
 *   data/account.json
 *   data/media.json
 *   data/comments/<mediaId>.json
 *   data/insights/<mediaId>.json
 *   data/transcripts/<mediaId>.json
 */

/** Media ids are numeric strings, but never trust them into a path. */
export function safeId(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_-]/g, "");
  if (!clean) throw new Error(`Некорректный id: ${JSON.stringify(id)}`);
  return clean;
}

function abs(relative: string): string {
  return path.join(config.dataDir, relative);
}

export async function readJson<T>(relative: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(abs(relative), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Distinguishes concurrent writes to the same path within one process. */
let writeCounter = 0;

export async function writeJson(relative: string, data: unknown): Promise<void> {
  const target = abs(relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated file behind.
  // The counter matters when parallel workers save progress to one file.
  const tmp = `${target}.${process.pid}.${writeCounter++}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, target);
}

export async function removeJson(relative: string): Promise<void> {
  await fs.rm(abs(relative), { force: true });
}

export async function listIds(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(abs(dir));
    return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export const paths = {
  account: "account.json",
  media: "media.json",
  comments: (id: string) => `comments/${safeId(id)}.json`,
  insights: (id: string) => `insights/${safeId(id)}.json`,
  transcript: (id: string) => `transcripts/${safeId(id)}.json`,
  draft: (id: string) => `drafts/${safeId(id)}.json`,
  conversation: (id: string) => `conversations/${safeId(id)}.json`,
  topics: "topics.json",
};
