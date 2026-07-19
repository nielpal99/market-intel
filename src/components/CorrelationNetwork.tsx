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
      <div style={{ fontWeight: 600 }}>Correlation Network</div>
      <svg width={width} height={height} style={{ marginTop: 8 }}>
        <rect width={width} height={height} fill="#111827" />
        {nodes.map((a, i) =>
          nodes.slice(i + 1).map((b, j) => (
            <line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#374151" strokeWidth={1} />
          ))
        )}
        {nodes.map((n, i) => (
          <g key={n.symbol} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={20} fill="#3b82f6" />
            <text textAnchor="middle" dy={5} fill="#fff" fontSize={10}>{n.symbol}</text>
          </g>
        ))}
      </svg>
      {data?.input?.caption && <p style={{ fontSize: 13, color: "#6b7280" }}>{data.input.caption}</p>}
    </div>
  );
}
