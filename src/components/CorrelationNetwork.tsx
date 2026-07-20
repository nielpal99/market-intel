"use client";

import { useState } from "react";

function sparklinePoints(series: Array<{ correlation: number }>, width: number, height: number, offsetX = 0, offsetY = 0) {
  return series
    .map((point, index) => {
      const x = offsetX + (series.length <= 1 ? width / 2 : (index / (series.length - 1)) * width);
      const y = offsetY + ((1 - Math.max(-1, Math.min(1, Number(point.correlation)))) / 2) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({ series }: { series: Array<{ minute: string; correlation: number; samples: number }> }) {
  const width = 160;
  const height = 42;
  const points = sparklinePoints(series, width, height);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--line)" strokeWidth={1} />
      {points && <polyline points={points} fill="none" stroke="var(--ice)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function CorrelationNetwork({ data }: { data: any }) {
  const rows = data?.rows || [];
  const symbols = (data?.symbols?.length ? data.symbols : Array.from(new Set(rows.map((r: any) => r.symbol)))) as string[];
  const correlations = data?.correlations || [];
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
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
  const activeEdge = correlations.find((edge: any) => `${edge.source}-${edge.target}` === activeEdgeId);

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ background: "var(--field)", borderRadius: 4 }}>
        <style>
          {`
            .correlation-edge .edge-details { opacity: 0; transition: opacity 120ms ease; }
            .correlation-edge:hover .edge-details,
            .correlation-edge:focus .edge-details { opacity: 1; }
          `}
        </style>
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
          const edgeId = `${edge.source}-${edge.target}`;
          const activateEdge = () => setActiveEdgeId(edgeId);
          const clearEdge = () => setActiveEdgeId((current) => (current === edgeId ? null : current));
          return (
            <g
              key={edgeId}
              className="correlation-edge"
              tabIndex={0}
              onMouseEnter={activateEdge}
              onMouseMove={activateEdge}
              onMouseLeave={clearEdge}
              onPointerEnter={activateEdge}
              onPointerMove={activateEdge}
              onPointerLeave={clearEdge}
              onClick={activateEdge}
              onFocus={activateEdge}
              onBlur={clearEdge}
              focusable="true"
              style={{ outline: "none" }}
            >
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={18}
                strokeLinecap="round"
                onMouseEnter={activateEdge}
                onMouseMove={activateEdge}
                onPointerEnter={activateEdge}
                onPointerMove={activateEdge}
                onClick={activateEdge}
                style={{ cursor: "default" }}
              />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                strokeLinecap="round"
                onMouseEnter={activateEdge}
                onMouseMove={activateEdge}
                onPointerEnter={activateEdge}
                onPointerMove={activateEdge}
                onClick={activateEdge}
                style={{ cursor: "default" }}
              />
              <text
                textAnchor="middle"
                x={midX}
                y={midY - 6}
                fill="var(--ink)"
                fontSize={10}
                fontFamily="var(--font-mono)"
                onMouseEnter={activateEdge}
                onMouseMove={activateEdge}
                onPointerEnter={activateEdge}
                onPointerMove={activateEdge}
                onClick={activateEdge}
              >
                {coefficient.toFixed(2)}
              </text>
              <g className="edge-details" pointerEvents="none">
                <rect
                  x={Math.max(8, Math.min(width - 178, midX - 84))}
                  y={midY > height - 74 ? midY - 70 : midY + 12}
                  width={170}
                  height={56}
                  rx={4}
                  fill="var(--panel)"
                  stroke="var(--line)"
                />
                <text
                  x={Math.max(16, Math.min(width - 170, midX - 76))}
                  y={midY > height - 74 ? midY - 50 : midY + 32}
                  fill="var(--ink)"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                >
                  {edge.source}/{edge.target} {coefficient.toFixed(3)}
                </text>
                <line
                  x1={Math.max(16, Math.min(width - 170, midX - 76))}
                  y1={(midY > height - 74 ? midY - 30 : midY + 52) + 11}
                  x2={Math.max(16, Math.min(width - 170, midX - 76)) + 140}
                  y2={(midY > height - 74 ? midY - 30 : midY + 52) + 11}
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <polyline
                  points={sparklinePoints(
                    edge.series || [],
                    140,
                    22,
                    Math.max(16, Math.min(width - 170, midX - 76)),
                    midY > height - 74 ? midY - 30 : midY + 52
                  )}
                  fill="none"
                  stroke="var(--ice)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
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
      {activeEdge && (
        <div className="readout-caption" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>
            {activeEdge.source}/{activeEdge.target}: {Number(activeEdge.correlation).toFixed(3)}
          </span>
          <Sparkline series={activeEdge.series || []} />
          <span>{activeEdge.series?.[activeEdge.series.length - 1]?.samples ?? activeEdge.samples} samples</span>
        </div>
      )}
      {correlations.length > 0 && (
        <div className="readout-caption">
          {correlations.map((edge: any) => `${edge.source}/${edge.target}: ${Number(edge.correlation).toFixed(3)} (${edge.samples} samples)`).join("  ")}
        </div>
      )}
      {data?.input?.caption && <p className="readout-caption">{data.input.caption}</p>}
    </div>
  );
}
