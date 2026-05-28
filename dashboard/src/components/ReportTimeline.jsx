import { useState } from "react";

const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

/**
 * Timeline horizontal de reportes históricos del tipo de auditoría activo.
 * Cada chip es interactivo: click selecciona, hover previsualiza.
 */
export default function ReportTimeline({ reports, selectedPath, onSelect, accent, loading }) {
  if (loading) {
    return (
      <div style={styles.scroller}>
        {[1,2,3,4,5].map((i) => (
          <div key={i} className="skeleton" style={{ height: 86, minWidth: 180, flexShrink: 0 }} />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div style={styles.empty}>
        Sin reportes para esta auditoría todavía.
      </div>
    );
  }

  return (
    <div style={styles.scroller}>
      {reports.map((r) => (
        <TimelineChip
          key={r.path}
          report={r}
          selected={r.path === selectedPath}
          accent={accent}
          onClick={() => onSelect(r.path)}
        />
      ))}
    </div>
  );
}

function TimelineChip({ report, selected, accent, onClick }) {
  const [hover, setHover] = useState(false);
  const date = formatDate(report.timestamp);
  const { compliant, needs_action, total, skipped } = report.summary;
  const active = total - skipped;
  const compliance = active > 0 ? Math.round((compliant / active) * 100) : 0;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.chip,
        borderColor: selected ? accent : (hover ? "var(--border-strong)" : "var(--border)"),
        background: selected ? `${accent}0c` : "var(--surface)",
        boxShadow: selected
          ? `0 0 0 2px ${accent}33, var(--shadow-sm)`
          : (hover ? "var(--shadow)" : "var(--shadow-sm)"),
        transform: hover && !selected ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <div style={styles.chipTop}>
        <div style={styles.chipDate}>{date}</div>
        {report.account_id && (
          <span
            style={{
              ...styles.accountTag,
              background: `${accent}1a`,
              color: accent,
            }}
          >
            {ACCOUNT_ALIASES[report.account_id] ?? report.account_id}
          </span>
        )}
      </div>

      <div style={styles.chipStats}>
        <span style={styles.statBig}>{compliance}%</span>
        <span style={styles.statLabel}>cobertura</span>
      </div>

      <div style={styles.chipBar}>
        <div
          style={{
            ...styles.chipBarFill,
            width: `${compliance}%`,
            background: complianceColor(compliance),
          }}
        />
      </div>

      <div style={styles.chipMeta}>
        <span style={{ color: "var(--green)" }}>✓ {compliant}</span>
        <span style={{ color: needs_action > 0 ? "var(--red)" : "var(--muted)" }}>
          ⚠ {needs_action}
        </span>
        <span style={{ color: "var(--muted)" }}>/ {active}</span>
      </div>
    </button>
  );
}

function complianceColor(pct) {
  if (pct >= 95) return "var(--green)";
  if (pct >= 70) return "var(--yellow)";
  return "var(--red)";
}

function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString("es-PE", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

const styles = {
  scroller: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    padding: "4px 2px 12px",
    scrollSnapType: "x proximity",
  },
  empty: {
    padding: "24px",
    background: "var(--surface)",
    border: "1px dashed var(--border-strong)",
    borderRadius: "var(--radius)",
    textAlign: "center",
    color: "var(--muted)",
    fontSize: 13,
  },
  chip: {
    minWidth: 200,
    flexShrink: 0,
    padding: "12px 14px",
    border: "2px solid var(--border)",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    transition: "all var(--t-fast)",
    scrollSnapAlign: "start",
    textAlign: "left",
    fontFamily: "inherit",
  },
  chipTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  chipDate: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-2)",
  },
  accountTag: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: ".05em",
    textTransform: "uppercase",
    padding: "2px 6px",
    borderRadius: 4,
  },
  chipStats: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 8,
  },
  statBig: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text)",
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    color: "var(--muted)",
  },
  chipBar: {
    height: 4,
    background: "var(--border)",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 8,
  },
  chipBarFill: {
    height: "100%",
    transition: "width var(--t-base)",
  },
  chipMeta: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    fontWeight: 500,
  },
};
