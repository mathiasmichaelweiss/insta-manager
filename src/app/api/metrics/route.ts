import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { loadMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Derived per-post numbers for the table. Reads from disk only. */
export async function GET() {
  try {
    return NextResponse.json(await loadMetrics());
  } catch (err) {
    return fail(err);
  }
}
