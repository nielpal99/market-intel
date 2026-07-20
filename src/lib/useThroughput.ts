"use client";

import { useEffect, useState } from "react";

export type Bucket = { t: number; rows: number };
export type TickerPrice = { symbol: string; price: number; timestamp: string };
export type Throughput = { buckets: Bucket[]; ageSeconds: number | null; live: boolean; prices: TickerPrice[] };

// Single poll of real ingestion throughput (ingest_heartbeats), shared by the
// signal-rail trace and the status-strip beacon. Presentation support only —
// no chat/tool logic touched.
export function useThroughput(intervalMs = 5000): Throughput {
  const [data, setData] = useState<Throughput>({ buckets: [], ageSeconds: null, live: false, prices: [] });

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/throughput");
        if (!res.ok) return;
        const json = (await res.json()) as Throughput;
        if (alive) setData(json);
      } catch {
        /* transient; keep last frame */
      }
    };
    poll();
    const id = setInterval(poll, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);

  return data;
}
