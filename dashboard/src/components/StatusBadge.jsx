const CONFIG = {
  Compliant:       { bg: "var(--green-soft)",  color: "#047857", label: "Compliant",     icon: "✓" },
  Partial:         { bg: "var(--yellow-soft)", color: "#b45309", label: "Partial",       icon: "⚠" },
  "Non-compliant": { bg: "var(--red-soft)",    color: "#b91c1c", label: "Non-compliant", icon: "✗" },
  Skipped:         { bg: "#f3f4f6",            color: "#6b7280", label: "Skipped",       icon: "⏭" },
};

export default function StatusBadge({ status, size = "sm" }) {
  const cfg = CONFIG[status] ?? { bg: "#f3f4f6", color: "#6b7280", label: status, icon: "•" };
  const pad  = size === "lg" ? "5px 12px" : "3px 9px";
  const fs   = size === "lg" ? 13 : 11.5;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: cfg.bg,
        color: cfg.color,
        borderRadius: 999,
        padding: pad,
        fontSize: fs,
        fontWeight: 600,
        whiteSpace: "nowrap",
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontSize: fs - 1 }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
