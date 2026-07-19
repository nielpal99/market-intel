"use client";

import { useEffect, useRef } from "react";

export function Candlestick({ data }: { data: any }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !data?.ohlc) return;
    let chart: any;
    (async () => {
      const { createChart, CandlestickSeries } = await import("lightweight-charts");
      chart = createChart(ref.current!, { width: ref.current!.clientWidth, height: 300, layout: { background: { color: "#111827" }, textColor: "#d1d5db" } });
      const series = chart.addSeries(CandlestickSeries);
      const rows = data.ohlc.map((r: any) => ({
        // ClickHouse returns "YYYY-MM-DD HH:MM:SS" (UTC, no zone marker);
        // lightweight-charts wants unix seconds for intraday data.
        time: Math.floor(new Date(String(r.minute).replace(" ", "T") + "Z").getTime() / 1000),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      }));
      series.setData(rows);
      chart.timeScale().fitContent();
    })();
    return () => chart?.remove();
  }, [data]);

  return (
    <div>
      <div style={{ fontWeight: 600 }}>{data?.input?.symbol} — Candlestick</div>
      <div ref={ref} style={{ width: "100%", height: 300 }} />
      {data?.input?.caption && <p style={{ fontSize: 13, color: "#6b7280" }}>{data.input.caption}</p>}
    </div>
  );
}
