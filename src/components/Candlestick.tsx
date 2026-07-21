"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VerdictCard } from "./VerdictCard";

type CandlestickPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

function toUnixSeconds(minute: unknown) {
  return Math.floor(new Date(String(minute).replace(" ", "T") + "Z").getTime() / 1000);
}

function toIso(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

export function Candlestick({ data, onDrillDown }: { data: any; onDrillDown?: (message: string) => void }) {
  if (data?.__renderAs === "verdict_card" || data?.verdict) return <VerdictCard data={data} />;
  return <CandlestickChart data={data} onDrillDown={onDrillDown} />;
}

function CandlestickChart({ data, onDrillDown }: { data: any; onDrillDown?: (message: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<number | null>(null);
  const drillTimeout = useRef<NodeJS.Timeout | null>(null);
  const [selection, setSelection] = useState<{ left: number; width: number } | null>(null);
  const [drillPending, setDrillPending] = useState(false);

  const rows = useMemo<CandlestickPoint[]>(
    () =>
      (data?.ohlc || []).map((r: any) => ({
        // ClickHouse returns "YYYY-MM-DD HH:MM:SS" (UTC, no zone marker);
        // lightweight-charts wants unix seconds for intraday data.
        time: toUnixSeconds(r.minute),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      })),
    [data]
  );

  const timeBounds = useMemo(() => {
    const times = rows.map((row) => row.time).filter(Number.isFinite);
    if (times.length < 1) return null;
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [rows]);

  useEffect(() => {
    if (!ref.current || !rows.length) return;
    let chart: any;
    (async () => {
      const { createChart, CandlestickSeries } = await import("lightweight-charts");
      chart = createChart(ref.current!, {
        width: ref.current!.clientWidth,
        height: 300,
        layout: { background: { color: "#0f1e27" }, textColor: "#6e8797", fontFamily: "IBM Plex Mono, monospace" },
        grid: { vertLines: { color: "#1b2f3a" }, horzLines: { color: "#1b2f3a" } },
        rightPriceScale: { borderColor: "#1b2f3a" },
        timeScale: { borderColor: "#1b2f3a" },
      });
      // upColor/downColor stay green/red — reserved price-direction semantics.
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#35c48a",
        downColor: "#f0526a",
        borderUpColor: "#35c48a",
        borderDownColor: "#f0526a",
        wickUpColor: "#35c48a",
        wickDownColor: "#f0526a",
      });
      series.setData(rows);
      chart.timeScale().fitContent();
    })();
    return () => chart?.remove();
  }, [rows]);

  useEffect(() => {
    return () => {
      if (drillTimeout.current) clearTimeout(drillTimeout.current);
    };
  }, []);

  const timeAtClientX = (clientX: number) => {
    if (!ref.current || !timeBounds) return null;
    const rect = ref.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(timeBounds.min + ratio * (timeBounds.max - timeBounds.min));
  };

  const sendRange = (startX: number, endX: number) => {
    if (!onDrillDown || !ref.current || !timeBounds || timeBounds.max <= timeBounds.min) return;
    const start = timeAtClientX(startX);
    const end = timeAtClientX(endX);
    if (start === null || end === null) return;
    const distance = Math.abs(endX - startX);
    const from = distance < 8 ? Math.max(timeBounds.min, start - 5 * 60) : Math.min(start, end);
    const to = distance < 8 ? Math.min(timeBounds.max, start + 5 * 60) : Math.max(start, end);
    setDrillPending(true);
    if (drillTimeout.current) clearTimeout(drillTimeout.current);
    drillTimeout.current = setTimeout(() => setDrillPending(false), 1400);
    onDrillDown(`show me ${data?.input?.symbol ?? "this symbol"} between ${toIso(from)} and ${toIso(to)}`);
  };

  return (
    <div>
      <div
        className={`chart-drill-surface ${drillPending ? "is-drilling" : ""}`}
        style={{ position: "relative", width: "100%", height: 300, cursor: onDrillDown ? "crosshair" : "default" }}
        onPointerDown={(event) => {
          pointerStart.current = event.clientX;
          setSelection({ left: event.nativeEvent.offsetX, width: 0 });
        }}
        onPointerMove={(event) => {
          if (pointerStart.current === null || !ref.current) return;
          const rect = ref.current.getBoundingClientRect();
          const start = Math.max(0, Math.min(rect.width, pointerStart.current - rect.left));
          const current = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
          setSelection({ left: Math.min(start, current), width: Math.abs(current - start) });
        }}
        onPointerUp={(event) => {
          if (pointerStart.current !== null) sendRange(pointerStart.current, event.clientX);
          pointerStart.current = null;
          setSelection(null);
        }}
        onPointerCancel={() => {
          pointerStart.current = null;
          setSelection(null);
        }}
      >
        <div ref={ref} style={{ width: "100%", height: 300 }} />
        {selection && (
          <div
            aria-hidden="true"
            className="range-selection"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: selection.left,
              width: Math.max(1, selection.width),
              pointerEvents: "none",
            }}
          />
        )}
        {drillPending && <div aria-hidden="true" className="drill-ack" />}
      </div>
      {data?.queryStats && (
        <p className="readout-caption mono" style={{ color: "var(--mute)" }}>
          scanned {Number(data.queryStats.readRows).toLocaleString()} rows · {data.queryStats.resultRows} returned · {data.queryStats.elapsedMs}ms
        </p>
      )}
      {data?.input?.caption && <p className="readout-caption">{data.input.caption}</p>}
    </div>
  );
}
