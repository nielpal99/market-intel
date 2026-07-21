"use client";

// Skeleton placeholders for render_* tool parts before output-available.
// Heights and aspect-ratios are kept in sync with the real widget dimensions
// so the swap produces no layout shift.

function CandlestickSkeleton() {
  const W = 600;
  const H = 300;
  const bars = [42, 68, 38, 75, 55, 48, 82, 52, 67, 44, 58, 72, 60, 35, 70, 50];
  const barW = 22;
  const gap = (W - bars.length * barW) / (bars.length + 1);
  return (
    <svg
      className="skeleton"
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ background: "var(--field)", borderRadius: 4, display: "block" }}
    >
      {bars.map((bodyH, i) => {
        const x = gap + i * (barW + gap);
        const y = H - 24 - bodyH;
        const wickH = Math.round(bodyH * 0.28);
        return (
          <g key={i} fill="var(--mute)">
            <rect x={x + barW * 0.44} y={y - wickH} width={2} height={wickH} rx={1} />
            <rect x={x} y={y} width={barW} height={bodyH} rx={2} />
            <rect x={x + barW * 0.44} y={y + bodyH} width={2} height={wickH * 0.6} rx={1} />
          </g>
        );
      })}
    </svg>
  );
}

function HeatmapSkeleton() {
  return (
    <div
      className="skeleton"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(58px, 1fr))", gap: 4 }}
    >
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          style={{ height: 38, background: "var(--mute)", borderRadius: 3 }}
        />
      ))}
    </div>
  );
}

function BandsSkeleton() {
  const W = 600;
  const H = 200;
  return (
    <svg
      className="skeleton"
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ background: "var(--field)", borderRadius: 4, display: "block" }}
    >
      <path
        d="M0,55 C80,42 160,68 260,50 S440,38 600,55 L600,148 C520,140 430,160 300,148 S100,138 0,148 Z"
        fill="var(--mute)"
        opacity={0.22}
      />
      <path d="M0,55 C80,42 160,68 260,50 S440,38 600,55" fill="none" stroke="var(--mute)" strokeWidth={1} />
      <path d="M0,148 C100,138 200,158 300,148 S500,138 600,148" fill="none" stroke="var(--mute)" strokeWidth={1} />
      <path d="M0,100 C80,92 160,110 260,98 S440,88 600,100" fill="none" stroke="var(--mute)" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.6} />
    </svg>
  );
}

function NetworkSkeleton() {
  const W = 400;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const r = 95;
  const nodes = [0, 1, 2].map((i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / 3 - Math.PI / 2),
    y: cy + r * Math.sin((2 * Math.PI * i) / 3 - Math.PI / 2),
  }));
  return (
    <svg
      className="skeleton"
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ background: "var(--field)", borderRadius: 4, display: "block" }}
    >
      {([[0, 1], [1, 2], [0, 2]] as [number, number][]).map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="var(--mute)" strokeWidth={1.5} opacity={0.5}
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={24} fill="var(--panel)" stroke="var(--mute)" strokeWidth={1.5} />
          <rect x={n.x - 12} y={n.y - 3} width={24} height={6} rx={3} fill="var(--mute)" opacity={0.5} />
        </g>
      ))}
    </svg>
  );
}

function VerdictSkeleton() {
  return (
    <div className="skeleton" style={{ padding: "4px 0" }}>
      <div style={{ height: 17, width: "68%", background: "var(--mute)", borderRadius: 3, marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ height: 38, width: 56, background: "var(--mute)", borderRadius: 3 }} />
        <div style={{ height: 13, width: 88, background: "var(--mute)", borderRadius: 3, opacity: 0.6 }} />
        <div style={{ height: 13, width: 72, background: "var(--mute)", borderRadius: 3, opacity: 0.6 }} />
      </div>
    </div>
  );
}

const SKELETONS: Record<string, () => JSX.Element> = {
  "tool-render_candlestick":        CandlestickSkeleton,
  "tool-render_spread_heatmap":     HeatmapSkeleton,
  "tool-render_volatility_bands":   BandsSkeleton,
  "tool-render_correlation_network": NetworkSkeleton,
  "tool-render_verdict_card":       VerdictSkeleton,
};

export function WidgetSkeleton({ type }: { type: string }) {
  const Sk = SKELETONS[type];
  return Sk ? <Sk /> : null;
}
