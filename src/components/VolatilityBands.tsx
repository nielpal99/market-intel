export function VolatilityBands({ data }: { data: any }) {
  const rows = data?.ohlc || [];
  const closes = rows.map((r: any) => Number(r.close));
  const mean = closes.length ? closes.reduce((a: number, b: number) => a + b, 0) / closes.length : 0;
  const std = Math.sqrt(closes.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / (closes.length || 1));
  return (
    <div>
      <div style={{ fontWeight: 600 }}>Volatility Bands</div>
      <svg width="100%" height={200} viewBox={`0 0 ${rows.length || 1} 200`} preserveAspectRatio="none" style={{ marginTop: 8 }}>
        {rows.map((r: any, i: number) => {
          const close = Number(r.close);
          const y = 200 - ((close - (mean - 2 * std)) / (4 * std || 1)) * 200;
          return <circle key={i} cx={i} cy={y} r={1.5} fill="#10b981" />;
        })}
      </svg>
      {data?.input?.caption && <p style={{ fontSize: 13, color: "#6b7280" }}>{data.input.caption}</p>}
    </div>
  );
}
