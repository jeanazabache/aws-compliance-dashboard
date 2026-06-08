import { useState } from "react";

/**
 * Cards-tabs por tipo de auditoría. Cada uno muestra:
 * - icono + título + descripción
 * - número de reportes históricos
 * - resumen del último resultado
 */
export default function AuditTypeTabs({ types, activeType, stats, loading, onSelect }) {
  return (
    <div style={styles.grid}>
      {types.map((t) => (
        <TabCard
          key={t.id}
          type={t}
          stats={stats[t.id]}
          active={activeType === t.id}
          loading={loading}
          onClick={() => onSelect(t.id)}
        />
      ))}
    </div>
  );
}

function TabCard({ type, stats, active, loading, onClick }) {
  const [hover, setHover] = useState(false);
  const agg = stats?.aggregated;

  // Para CloudWatch Logs no aplica un % de compliance — mostramos GB ingestados totales.
  const isLogsAudit = type.id === "audit_cloudwatch_logs";
  // Para estos reportes informativos no se muestra porcentaje de compliance.
  const isInformativeAudit = type.id === "audit_apigateway_logs" || type.id === "audit_lambda_logging";

  let primary = null;
  let primaryColor = "var(--muted)";
  let secondary = null;

  if (agg) {
    if (isLogsAudit) {
      // Sumar bytes y costo desde los summaries de cada cuenta más reciente.
      const totalBytes = stats.latestByAccount
        ? Object.values(stats.latestByAccount).reduce((s, r) => s + (r.summary?.total_incoming_bytes ?? 0), 0)
        : 0;
      const totalCost = stats.latestByAccount
        ? Object.values(stats.latestByAccount).reduce((s, r) => s + (r.summary?.estimated_cost_usd ?? 0), 0)
        : 0;
      primary = formatBytesShort(totalBytes);
      primaryColor = totalCost > 100 ? "var(--red)" : (totalCost > 30 ? "var(--yellow)" : "var(--green)");
      secondary = `$${totalCost.toFixed(0)} USD/sem · ${agg.total.toLocaleString()} log groups`;
    } else if (isInformativeAudit) {
      primary = "—";
      primaryColor = "transparent";
      secondary = `${agg.accounts > 1 ? `${agg.accounts} cuentas · ` : ""}${stats.count} reportes`;
    } else {
      const denominator = agg.total - agg.skipped;
      const pct = denominator > 0 ? Math.round((agg.compliant / denominator) * 100) : null;
      if (pct !== null) {
        primary = `${pct}%`;
        primaryColor = complianceColor(pct);
        secondary = `${agg.compliant.toLocaleString()} / ${agg.total.toLocaleString()} compliant`;
      }
    }
  }

  const accountsLabel = agg && agg.accounts > 1 ? `${agg.accounts} cuentas` : null;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.card,
        borderColor: active ? type.accent : (hover ? "var(--border-strong)" : "var(--border)"),
        boxShadow: active
          ? `0 0 0 3px ${type.accent}22, 0 8px 24px rgba(15,23,42,.06)`
          : (hover ? "var(--shadow-lg)" : "var(--shadow-sm)"),
        transform: hover && !active ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      <div style={styles.cardLeft}>
        <div
          style={{
            ...styles.iconWrap,
            background: active ? type.accent : `${type.accent}15`,
            color: active ? "#fff" : type.accent,
          }}
        >
          <span style={{ fontSize: 22 }}>{type.icon}</span>
        </div>
        <div>
          <div style={styles.cardTitle}>{type.label}</div>
          <div style={styles.cardDesc}>{type.description}</div>
        </div>
      </div>

      <div style={styles.cardRight}>
        {loading ? (
          <div className="skeleton" style={{ height: 30, width: 80 }} />
        ) : primary !== null ? (
          <>
            <div style={{ ...styles.complianceValue, color: primaryColor }}>
              {primary}
            </div>
            <div style={styles.cardMeta}>{secondary}</div>
            {!isInformativeAudit && (
              <div style={styles.cardMeta}>
                {accountsLabel ? `${accountsLabel} · ` : ""}{stats.count} reportes
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ ...styles.complianceValue, color: "var(--muted)" }}>—</div>
            <div style={styles.cardMeta}>Sin reportes aún</div>
          </>
        )}
      </div>

      {active && <div style={{ ...styles.activeBar, background: type.accent }} />}
    </button>
  );
}

function formatBytesShort(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function complianceColor(pct) {
  if (pct >= 95) return "var(--green)";
  if (pct >= 70) return "var(--yellow)";
  return "var(--red)";
}

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 16,
  },
  card: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "18px 20px",
    background: "var(--surface)",
    border: "2px solid var(--border)",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    textAlign: "left",
    transition: "all var(--t-base)",
    overflow: "hidden",
  },
  cardLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all var(--t-base)",
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 12,
    color: "var(--muted)",
  },
  cardRight: {
    textAlign: "right",
    flexShrink: 0,
  },
  complianceValue: {
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1,
  },
  cardMeta: {
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 4,
  },
  activeBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
  },
};
