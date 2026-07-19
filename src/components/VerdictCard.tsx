export function VerdictCard({ data }: { data: any }) {
  return (
    <div style={{ border: "1px solid #374151", borderRadius: 8, padding: 16, background: "#111827" }}>
      <h3 style={{ margin: "0 0 8px" }}>Verdict</h3>
      <p style={{ margin: 0, fontSize: 18 }}>{data?.verdict || "No verdict"}</p>
      <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 14, color: "#9ca3af" }}>
        <span>confidence: {data?.confidence ?? "-"}</span>
        {data?.stats?.map((s: any, i: number) => (
          <span key={i}>{s.label}: {s.value}</span>
        ))}
      </div>
      {data?.caption && <p style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>{data.caption}</p>}
    </div>
  );
}
