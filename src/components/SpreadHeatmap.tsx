export function SpreadHeatmap({ data }: { data: any }) {
  const rows = data?.rows || [];
  const max = rows.length ? Math.max(...rows.map((r: any) => Math.abs(Number(r.spread_a_over_b)))) : 1;
  return (
    <div>
      <div style={{ fontWeight: 600 }}>Spread Heatmap</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(60px, 1fr))", gap: 4, marginTop: 8 }}>
        {rows.slice(0, 60).map((r: any, i: number) => {
          const value = Math.abs(Number(r.spread_a_over_b));
          const intensity = max ? value / max : 0;
          return (
            <div key={i} title={`${r.exchange_a}/${r.exchange_b}: ${value.toFixed(4)}`} style={{ background: `rgba(59, 130, 246, ${intensity})`, padding: 8, borderRadius: 4, fontSize: 10, textAlign: "center" }}>
              {value.toFixed(3)}
            </div>
          );
        })}
      </div>
      {data?.input?.caption && <p style={{ fontSize: 13, color: "#6b7280" }}>{data.input.caption}</p>}
    </div>
  );
}
