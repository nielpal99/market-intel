function toIso(timestamp: unknown) {
  const value = String(timestamp);
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized).toISOString();
}

export function SpreadHeatmap({ data, onDrillDown }: { data: any; onDrillDown?: (message: string) => void }) {
  const rows = data?.rows || [];
  const max = rows.length ? Math.max(...rows.map((r: any) => Math.abs(Number(r.spread_a_over_b)))) : 1;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(58px, 1fr))", gap: 4 }}>
        {rows.slice(0, 60).map((r: any, i: number) => {
          const value = Math.abs(Number(r.spread_a_over_b));
          const intensity = max ? value / max : 0;
          const symbol = r.symbol ?? data?.input?.symbol ?? "this symbol";
          const timestamp = toIso(r.timestamp);
          const delta = r.time_delta_ms !== undefined ? `, matched within ${r.time_delta_ms}ms` : "";
          return (
            <div
              key={i}
              className="mono"
              role={onDrillDown ? "button" : undefined}
              tabIndex={onDrillDown ? 0 : undefined}
              title={`${symbol} ${r.exchange_a}/${r.exchange_b}: ${value.toFixed(4)} at ${timestamp}`}
              onClick={() =>
                onDrillDown?.(
                  `show me the ${symbol} trades around ${timestamp} that produced this spread reading (${r.exchange_a}/${r.exchange_b}, spread ${Number(r.spread_a_over_b).toFixed(4)}${delta})`
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onDrillDown?.(
                    `show me the ${symbol} trades around ${timestamp} that produced this spread reading (${r.exchange_a}/${r.exchange_b}, spread ${Number(r.spread_a_over_b).toFixed(4)}${delta})`
                  );
                }
              }}
              style={{
                background: `rgba(116, 199, 214, ${0.08 + intensity * 0.75})`,
                color: intensity > 0.5 ? "#06171b" : "var(--ink)",
                padding: 8,
                borderRadius: 3,
                fontSize: 10,
                textAlign: "center",
                cursor: onDrillDown ? "pointer" : "default",
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
