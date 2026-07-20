"use client";

export interface HITLApproval {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  event?: {
    symbol?: string;
    event_type?: string;
    severity?: number;
    window_start?: string;
    window_end?: string;
    detail?: string;
  } | null;
  requestedAt?: string;
}

export interface HITLCardProps {
  approval: HITLApproval;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

function formatTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString();
}

export function HITLCard({ approval, onApprove, onDeny }: HITLCardProps) {
  const input = approval.toolInput || {};
  const event = approval.event || input;
  const symbol = (event.symbol ?? input.symbol ?? "—") as string;
  const eventType = (event.event_type ?? input.event_type ?? approval.toolName) as string;
  const severity = event.severity ?? input.severity;
  const detail = (event.detail ?? input.detail ?? "") as string;
  const windowStart = formatTime(event.window_start as string | undefined);
  const windowEnd = formatTime(event.window_end as string | undefined);

  return (
    <div style={{ border: "1px solid #374151", borderRadius: 8, padding: 16, background: "#111827", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ color: "#f59e0b" }}>System alert</strong>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{formatTime(approval.requestedAt)}</span>
      </div>
      <p style={{ margin: "0 0 8px" }}>
        {symbol} · {eventType}
        {typeof severity === "number" && ` · severity ${severity.toFixed(2)}`}
      </p>
      {windowStart !== "—" && (
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#9ca3af" }}>
          Window {windowStart} → {windowEnd}
        </p>
      )}
      {detail && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#d1d5db" }}>{detail}</p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onApprove(approval.id)}
          style={{ padding: "6px 14px", borderRadius: 6, background: "#10b981", border: "none", color: "#fff", cursor: "pointer" }}
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(approval.id)}
          style={{ padding: "6px 14px", borderRadius: 6, background: "#ef4444", border: "none", color: "#fff", cursor: "pointer" }}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
