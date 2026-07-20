export function VerdictCard({ data }: { data: any }) {
  const confidence = typeof data?.confidence === "number" ? data.confidence : null;
  return (
    <div>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: "var(--ink)" }}>
        {data?.verdict || "No verdict"}
      </p>
      <div style={{ display: "flex", gap: 20, marginTop: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        {confidence !== null && (
          <span className="mono" style={{ fontSize: 24, color: "var(--ice)", letterSpacing: "-0.02em" }}>
            {(confidence * 100).toFixed(0)}
            <span style={{ fontSize: 12, color: "var(--mute)", marginLeft: 4 }}>% conf</span>
          </span>
        )}
        {data?.stats?.map((s: any, i: number) => (
          <span key={i} className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
            <span style={{ color: "var(--mute)" }}>{s.label} </span>
            {s.value}
          </span>
        ))}
      </div>
      {data?.caption && <p className="readout-caption">{data.caption}</p>}
    </div>
  );
}
