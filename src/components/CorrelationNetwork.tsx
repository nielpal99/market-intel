export function CorrelationNetwork({ data }: { data: any }) {
  const rows = data?.rows || [];
  const symbols = (data?.symbols?.length ? data.symbols : Array.from(new Set(rows.map((r: any) => r.symbol)))) as string[];
  const correlations = data?.correlations || [];
  const width = 400;
  const height = 300;
  const center = { x: width / 2, y: height / 2 };
  const radius = 100;
  const nodes = symbols.map((s, i) => ({
    symbol: s,
    x: center.x + radius * Math.cos((2 * Math.PI * i) / symbols.length),
    y: center.y + radius * Math.sin((2 * Math.PI * i) / symbols.length),
  }));
  const nodeBySymbol = new Map(nodes.map((node) => [node.symbol, node]));

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ background: "var(--field)", borderRadius: 4 }}>
        {correlations.map((edge: any) => {
          const a = nodeBySymbol.get(edge.source);
          const b = nodeBySymbol.get(edge.target);
          if (!a || !b) return null;
          const coefficient = Number(edge.correlation);
          const strength = Math.min(1, Math.abs(coefficient));
          const stroke = coefficient >= 0 ? "var(--ice)" : "var(--loss)";
          const strokeWidth = 1 + strength * 5;
          const opacity = 0.25 + strength * 0.75;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          return (
            <g key={`${edge.source}-${edge.target}`}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                strokeLinecap="round"
              />
              <text textAnchor="middle" x={midX} y={midY - 6} fill="var(--ink)" fontSize={10} fontFamily="var(--font-mono)">
                {coefficient.toFixed(2)}
              </text>
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.symbol} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={22} fill="var(--panel)" stroke="var(--ice)" strokeWidth={1.5} />
            <text textAnchor="middle" dy={4} fill="var(--ink)" fontSize={10} fontFamily="var(--font-mono)">
              {n.symbol}
            </text>
          </g>
        ))}
      </svg>
      {correlations.length > 0 && (
        <div className="readout-caption">
          {correlations.map((edge: any) => `${edge.source}/${edge.target}: ${Number(edge.correlation).toFixed(3)} (${edge.samples} samples)`).join("  ")}
        </div>
      )}
      {data?.input?.caption && <p className="readout-caption">{data.input.caption}</p>}
    </div>
  );
}
