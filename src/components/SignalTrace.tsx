"use client";

import type { Bucket } from "@/lib/useThroughput";

// The signature element: a live plotter trace running the left rail, driven by
// real ingestion throughput. Newest sample sits at the bottom "now" edge. Not
// decorative — a flat dashed line means the tape genuinely is quiet.
export function SignalTrace({ buckets, live }: { buckets: Bucket[]; live: boolean }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.rows), 0) || 1;
  const n = Math.max(buckets.length, 1);
  const points = buckets.map((b, i) => {
    const x = 6 + (b.rows / max) * 46; // throughput → x within a 60-wide viewBox
    const y = n === 1 ? 100 : (i / (n - 1)) * 96 + 2; // time → y (oldest top, now bottom)
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="trace" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 60 100" preserveAspectRatio="none">
        {[15, 30, 45].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="100" stroke="var(--line)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        ))}
        {points.length > 1 ? (
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke={live ? "var(--ice)" : "var(--ice-dim)"}
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ) : (
          <line x1="6" y1="0" x2="6" y2="100" stroke="var(--ice-dim)" strokeWidth="0.8" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="trace-live">
        <span
          className={`dot ${live ? "pulse" : ""}`}
          style={{ background: live ? "var(--ice)" : "var(--ice-dim)", boxShadow: live ? "0 0 8px var(--ice)" : "none" }}
        />
      </div>
    </div>
  );
}
