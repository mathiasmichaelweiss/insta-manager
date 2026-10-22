import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { readJson } from "@/lib/store";
import type { TopicsFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The saved result of the last topic analysis. */
export async function GET() {
  try {
    const file = await readJson<TopicsFile>("topics.json");
    if (!file) return NextResponse.json({ error: "Анализ ещё не запускался" }, { status: 404 });
    return NextResponse.json(file);
  } catch (err) {
    return fail(err);
  }
}
