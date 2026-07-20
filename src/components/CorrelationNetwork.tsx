export function CorrelationNetwork({ data }: { data: any }) {
  const rows = data?.rows || [];
  const symbols = Array.from(new Set(rows.map((r: any) => r.symbol))) as string[];
  const width = 400;
  const height = 300;
  const center = { x: width / 2, y: height / 2 };
  const radius = 100;
  const nodes = symbols.map((s, i) => ({
    symbol: s,
    x: center.x + radius * Math.cos((2 * Math.PI * i) / symbols.length),
    y: center.y + radius * Math.sin((2 * Math.PI * i) / symbols.length),
  }));
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ background: "var(--field)", borderRadius: 4 }}>
        {nodes.map((a, i) =>
          nodes.slice(i + 1).map((b, j) => (
            <line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line)" strokeWidth={1} />
          ))
        )}
        {nodes.map((n) => (
          <g key={n.symbol} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={22} fill="var(--panel)" stroke="var(--ice)" strokeWidth={1.5} />
            <text textAnchor="middle" dy={4} fill="var(--ink)" fontSize={10} fontFamily="var(--font-mono)">
              {n.symbol}
            </text>
          </g>
        ))}
      </svg>
      {data?.input?.caption && <p className="readout-caption">{data.input.caption}</p>}
    </div>
  );
}
