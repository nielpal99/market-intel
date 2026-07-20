export function SpreadHeatmap({ data }: { data: any }) {
  const rows = data?.rows || [];
  const max = rows.length ? Math.max(...rows.map((r: any) => Math.abs(Number(r.spread_a_over_b)))) : 1;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(58px, 1fr))", gap: 4 }}>
        {rows.slice(0, 60).map((r: any, i: number) => {
          const value = Math.abs(Number(r.spread_a_over_b));
          const intensity = max ? value / max : 0;
          return (
            <div
              key={i}
              className="mono"
              title={`${r.exchange_a}/${r.exchange_b}: ${value.toFixed(4)}`}
              style={{
                background: `rgba(116, 199, 214, ${0.08 + intensity * 0.75})`,
                color: intensity > 0.5 ? "#06171b" : "var(--ink)",
                padding: 8,
                borderRadius: 3,
                fontSize: 10,
                textAlign: "center",
              }}
            >
              {value.toFixed(3)}
            </div>
          );
        })}
      </div>
      {data?.input?.caption && <p className="readout-caption">{data.input.caption}</p>}
    </div>
  );
}
