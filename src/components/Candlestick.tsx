"use client";

import { useEffect, useRef } from "react";

export function Candlestick({ data }: { data: any }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !data?.ohlc) return;
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
      <div ref={ref} style={{ width: "100%", height: 300 }} />
      {data?.input?.caption && <p className="readout-caption">{data.input.caption}</p>}
    </div>
  );
}
