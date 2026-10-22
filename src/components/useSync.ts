"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, formatNumber, readNdjson } from "@/lib/format";
import type { SyncEvent } from "@/lib/types";

export type SyncKind = "comments" | "insights" | "transcripts";

export interface SyncState {
  kind: SyncKind | null;
  running: boolean;
  done: number;
  total: number;
  count: number;
  skipped: number;
  failed: number;
  flagged: number;
  /** Set when a run finishes; cleared when the next one starts. */
  summary?: string;
  warning?: string;
  error?: string;
}

const IDLE: SyncState = {
  kind: null,
  running: false,
  done: 0,
  total: 0,
  count: 0,
  skipped: 0,
  failed: 0,
  flagged: 0,
};

/**
 * Drives any /api/sync/* route: POSTs, reads the NDJSON progress stream and
 * keeps a live tally. `unit` names what is being counted, e.g. "комментариев".
 */
export function useSync(onFinish?: () => void | Promise<void>) {
  const [state, setState] = useState<SyncState>(IDLE);
  const abort = useRef<AbortController | null>(null);

  // Drop an in-flight run if the page goes away.
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(
    async (kind: SyncKind, url: string, unit: (n: number) => string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setState({ ...IDLE, kind, running: true });

      try {
        const res = await fetch(url, { method: "POST", signal: controller.signal });
        if (!res.ok) throw new Error(await errorText(res));

        for await (const event of readNdjson<SyncEvent>(res)) {
          switch (event.type) {
            case "start":
              setState((s) => ({ ...s, total: event.total }));
              break;
            case "progress":
              setState((s) => ({
                ...s,
                done: event.done,
                total: event.total,
                count: s.count + event.count,
                flagged: s.flagged + (event.flagged ? 1 : 0),
              }));
              break;
            case "skip":
              setState((s) => ({ ...s, done: event.done, total: event.total, skipped: s.skipped + 1 }));
              break;
            case "error":
              setState((s) => ({ ...s, done: event.done, total: event.total, failed: s.failed + 1 }));
              break;
            case "done":
              setState({
                kind,
                running: false,
                done: event.total,
                total: event.total,
                count: event.count,
                skipped: event.skipped,
                failed: event.failed,
                flagged: event.flagged,
                summary:
                  `Готово: ${event.succeeded} из ${event.total} — ${unit(event.count)}` +
                  (event.skipped ? `, пропущено: ${event.skipped}` : "") +
                  (event.failed ? `, ошибок: ${event.failed}` : "") +
                  (event.flagged ? `, требуют внимания: ${event.flagged}` : ""),
                warning: event.warning,
              });
              break;
          }
        }
        await onFinish?.();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setState(IDLE);
          return;
        }
        setState({ ...IDLE, error: err instanceof Error ? err.message : String(err) });
      }
    },
    [onFinish],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  const label = state.running
    ? `${state.done} из ${state.total || "?"} · ${formatNumber(state.count)}`
    : "";

  return { state, start, cancel, label };
}
