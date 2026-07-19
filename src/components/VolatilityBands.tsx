// Rolling volatility (Bollinger-style) bands: price line with a shaded
// mean ± 2σ envelope computed over a trailing window. Pure SVG, no deps.
export function VolatilityBands({ data }: { data: any }) {
  const rows = (data?.ohlc ?? []) as Array<{ minute: string; close: number }>;
  const closes = rows.map((r) => Number(r.close)).filter((n) => Number.isFinite(n));

  if (closes.length < 2) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>Volatility Bands</div>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          Not enough price data to plot bands yet.
        </p>
      </div>
    );
  }

  const W = 600;
  const H = 200;
  const PAD = 8;
  const n = closes.length;
  // Trailing window for the rolling stats — adaptive to series length.
  const period = Math.max(2, Math.min(20, Math.floor(n / 3)));

  const mean: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - period + 1);
    const win = closes.slice(start, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / win.length;
    const variance = win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length;
    const sd = Math.sqrt(variance);
    mean.push(m);
    upper.push(m + 2 * sd);
    lower.push(m - 2 * sd);
  }

  const lo = Math.min(...lower, ...closes);
  const hi = Math.max(...upper, ...closes);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
  const line = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // Shaded envelope: upper band forward, lower band back, closed.
  const bandArea =
    line(upper) +
    " " +
    lower.map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(lower[n - 1 - i]).toFixed(1)}`).join(" ") +
    " Z";

  const first = closes[0];
  const last = closes[n - 1];
  const up = last >= first;
  const priceColor = up ? "#10b981" : "#ef4444";

  return (
    <div>
      <div style={{ fontWeight: 600 }}>
        {data?.input?.symbol} — Volatility Bands
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 8, background: "#0b1220", borderRadius: 6 }}>
        <path d={bandArea} fill="rgba(59, 130, 246, 0.15)" stroke="none" />
        <path d={line(upper)} fill="none" stroke="#3b82f6" strokeWidth={1} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
        <path d={line(lower)} fill="none" stroke="#3b82f6" strokeWidth={1} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
        <path d={line(mean)} fill="none" stroke="#64748b" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={line(closes)} fill="none" stroke={priceColor} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#9ca3af", marginTop: 6 }}>
        <span>close: {last.toFixed(2)}</span>
        <span>mean ± 2σ over {period}m window</span>
      </div>
      {data?.input?.caption && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{data.input.caption}</p>}
    </div>
  );
}
