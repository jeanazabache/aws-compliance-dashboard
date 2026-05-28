import { useState, useMemo } from "react";
import StatusBadge from "./StatusBadge.jsx";

const STATUS_ORDER = ["Non-compliant", "Partial", "Compliant", "Skipped"];

// Map de filtros -> función de match contra status. "all" = sin filtro.
const FILTERS = {
  all:           null,
  needs_action:  (s) => s === "Non-compliant" || s === "Partial",
  Compliant:     (s) => s === "Compliant",
  Skipped:       (s) => s === "Skipped",
};

export default function UtpReposReportDetail({ report }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { summary, results = [], timestamp, mode, org, apply_actions } = report;

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    const matchStatus = FILTERS[filter];
    return results
      .filter((r) => !matchStatus || matchStatus(r.status))
      .filter((r) => !term || r.name.toLowerCase().includes(term))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  }, [results, filter, search]);

  const toggleFilter = (key) => setFilter((curr) => (curr === key ? "all" : key));

  return (
    <div>
      {/* Report header */}
      <div style={styles.reportHeader}>
        <div>
          <div style={styles.reportTitle}>Repositorios GitHub</div>
          <div style={styles.reportMeta}>
            <Pill label={formatDate(timestamp)} />
            <Pill label={org ?? "—"} />
            <Pill label={`modo: ${mode}`} accent />
          </div>
        </div>
      </div>

      {/* Summary cards (clickeables = filtros) */}
      <div style={styles.cards}>
        <SummaryCard
          value={summary.total}
          label="Total repos"
          color="var(--blue)"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <SummaryCard
          value={summary.compliant}
          label="Compliant"
          color="var(--green)"
          active={filter === "Compliant"}
          onClick={() => toggleFilter("Compliant")}
        />
        <SummaryCard
          value={summary.needs_action}
          label="Necesitan acción"
          color="var(--yellow)"
          active={filter === "needs_action"}
          onClick={() => toggleFilter("needs_action")}
        />
        <SummaryCard
          value={summary.skipped}
          label="Skipped"
          color="var(--muted)"
          active={filter === "Skipped"}
          onClick={() => toggleFilter("Skipped")}
        />
      </div>

      {/* Apply actions panel */}
      {apply_actions && apply_actions.length > 0 && (
        <Panel title="Acciones de remediación">
          <table style={styles.table}>
            <thead>
              <tr>
                {["Repo", "Acción", "Resultado", "Detalle"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {apply_actions.map((a, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}>{a.repo}</td>
                  <td style={styles.td}><code style={styles.code}>{a.action}</code></td>
                  <td style={styles.td}>
                    <span style={{ color: a.success ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                      {a.success ? "✓ OK" : "✗ Error"}
                    </span>
                  </td>
                  <td style={{ ...styles.td, color: "var(--muted)", fontSize: 12 }}>{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Toolbar (solo búsqueda, los filtros están en las cards de arriba) */}
      <div style={styles.toolbar}>
        <div style={styles.filterIndicator}>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              style={styles.clearFilterBtn}
              title="Quitar filtro"
            >
              <span>{labelForFilter(filter)} · {filtered.length}</span>
              <span style={styles.clearX}>✕</span>
            </button>
          )}
        </div>
        <input
          style={styles.searchInput}
          placeholder="🔍 Buscar repo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Results table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Repositorio", "master", "prd env", "team approval", "Estado"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...styles.td, textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  Sin resultados para el filtro actual
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.name} style={styles.trHover}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{r.name}</td>
                  <td style={styles.td}><BoolCell value={r.has_master} skipped={r.archived_or_disabled} /></td>
                  <td style={styles.td}><BoolCell value={r.has_prd} skipped={r.archived_or_disabled} /></td>
                  <td style={styles.td}><BoolCell value={r.has_team_approval} skipped={r.archived_or_disabled} /></td>
                  <td style={styles.td}><StatusBadge status={r.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div style={styles.footnote}>
          Mostrando <strong>{filtered.length}</strong> de {results.length} repositorios
        </div>
      )}
    </div>
  );
}

function SummaryCard({ value, label, color, active, onClick }) {
  const [hover, setHover] = useState(false);
  const isClickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={!isClickable}
      style={{
        ...styles.card,
        cursor: isClickable ? "pointer" : "default",
        textAlign: "left",
        fontFamily: "inherit",
        outline: "none",
        borderColor: active ? color : "var(--border)",
        borderWidth: active ? 2 : 1,
        padding: active ? "15px 17px" : "16px 18px",
        background: active ? `${color}10` : "var(--surface)",
        boxShadow: active
          ? `0 0 0 3px ${color}22, var(--shadow)`
          : (hover && isClickable ? "var(--shadow)" : "var(--shadow-sm)"),
        transform: hover && isClickable && !active ? "translateY(-1px)" : "translateY(0)",
        transition: "all var(--t-fast)",
      }}
    >
      <div style={{ ...styles.cardValue, color }}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </button>
  );
}

function labelForFilter(filter) {
  if (filter === "needs_action") return "Necesitan acción";
  return filter;
}

function Panel({ title, children }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>{title}</div>
      {children}
    </div>
  );
}

function Pill({ label, accent }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        background: accent ? "var(--accent-soft)" : "var(--surface-2)",
        color: accent ? "var(--accent)" : "var(--muted)",
        border: `1px solid ${accent ? "transparent" : "var(--border)"}`,
      }}
    >
      {label}
    </span>
  );
}

function BoolCell({ value, skipped }) {
  if (skipped) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <span style={{ color: value ? "var(--green)" : "var(--red)", fontSize: 16, fontWeight: 700 }}>
      {value ? "✓" : "✗"}
    </span>
  );
}

function formatDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-PE", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return ts; }
}

const styles = {
  reportHeader: { marginBottom: 20 },
  reportTitle: { fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--text)" },
  reportMeta: { display: "flex", gap: 8, flexWrap: "wrap" },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "16px 18px",
    transition: "all var(--t-fast)",
  },
  cardValue: { fontSize: 30, fontWeight: 700, lineHeight: 1 },
  cardLabel: { fontSize: 12, color: "var(--muted)", marginTop: 6 },
  panel: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 18,
    marginBottom: 20,
    boxShadow: "var(--shadow-sm)",
  },
  panelTitle: {
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 12,
    color: "var(--accent)",
    textTransform: "uppercase",
    letterSpacing: ".05em",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  filterIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
  },
  clearFilterBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "var(--accent-soft)",
    border: "1px solid var(--accent)",
    color: "var(--accent)",
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all var(--t-fast)",
  },
  clearX: {
    fontSize: 11,
    opacity: 0.7,
  },
  filterGroup: { display: "flex", gap: 6, flexWrap: "wrap" },
  filterBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all var(--t-fast)",
  },
  countPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    padding: "0 5px",
    background: "rgba(0,0,0,.08)",
    color: "inherit",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
  },
  searchInput: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    width: 240,
    transition: "border-color var(--t-fast), box-shadow var(--t-fast)",
  },
  tableWrap: {
    background: "var(--surface)",
    borderRadius: "var(--radius)",
    overflow: "auto",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)",
    WebkitOverflowScrolling: "touch",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: "12px 16px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".06em",
    color: "var(--muted)",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-2)",
  },
  tr: { borderBottom: "1px solid var(--border)" },
  trHover: {
    borderBottom: "1px solid var(--border)",
    transition: "background var(--t-fast)",
  },
  td: { padding: "12px 16px", fontSize: 13, color: "var(--text-2)" },
  code: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
  },
  footnote: {
    color: "var(--muted)",
    fontSize: 12,
    marginTop: 12,
    textAlign: "right",
  },
};
