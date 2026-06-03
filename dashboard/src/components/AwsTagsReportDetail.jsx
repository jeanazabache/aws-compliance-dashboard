import { useState, useMemo } from "react";
import StatusBadge from "./StatusBadge.jsx";
import { accountColor } from "./insightsHelpers.js";

const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

export default function AwsTagsReportDetail({ report }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");

  const {
    summary,
    results = [],
    services = [],
    timestamp,
    account_id,
    required_tag,
  } = report;

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return results
      .filter((r) => filter === "all" || r.status === filter)
      .filter((r) => serviceFilter === "all" || r.service === serviceFilter)
      .filter(
        (r) =>
          !term ||
          r.arn.toLowerCase().includes(term) ||
          (r.tag_value || "").toLowerCase().includes(term),
      );
  }, [results, filter, serviceFilter, search]);

  const toggleFilter = (key) => setFilter((curr) => (curr === key ? "all" : key));

  const coverage = summary.total
    ? Math.round((summary.compliant / summary.total) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={styles.reportHeader}>
        <div>
          <div style={styles.reportTitle}>Tags en recursos AWS</div>
          <div style={styles.reportMeta}>
            <Pill label={formatDate(timestamp)} />
            <Pill
              label={`Cuenta ${ACCOUNT_ALIASES[account_id] ?? account_id}`}
              color={accountColor(account_id)}
            />
            <Pill label={<>tag: <code style={styles.code}>{required_tag}</code></>} />
          </div>
        </div>
      </div>

      {/* Summary cards (clickeables = filtros) */}
      <div style={styles.cards}>
        <SummaryCard
          value={summary.total.toLocaleString()}
          label="Recursos auditados"
          color="var(--blue)"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <SummaryCard
          value={summary.compliant.toLocaleString()}
          label="Con tag"
          color="var(--green)"
          active={filter === "Compliant"}
          onClick={() => toggleFilter("Compliant")}
        />
        <SummaryCard
          value={summary.needs_action.toLocaleString()}
          label="Sin tag"
          color="var(--red)"
          active={filter === "Non-compliant"}
          onClick={() => toggleFilter("Non-compliant")}
        />
        <SummaryCard
          value={`${coverage}%`}
          label="Cobertura"
          color={coverageColor(coverage)}
        />
      </div>

      {/* Services breakdown */}
      {services.length > 0 && (
        <Panel title="Cobertura por servicio">
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Servicio", "Total", "Con tag", "Sin tag", "Cobertura"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {services.map((s) => {
                  const pct = s.total ? Math.round((s.compliant / s.total) * 100) : 0;
                  return (
                    <tr
                      key={s.service}
                      style={{ ...styles.trHover, cursor: "pointer" }}
                      onClick={() => setServiceFilter(s.service === serviceFilter ? "all" : s.service)}
                      title="Click para filtrar la tabla por este servicio"
                    >
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        {s.service}
                        {s.service === serviceFilter && (
                          <span style={styles.activeFilterBadge}>filtrado</span>
                        )}
                      </td>
                      <td style={styles.td}>{s.total.toLocaleString()}</td>
                      <td style={{ ...styles.td, color: "var(--green)", fontWeight: 600 }}>
                        {s.compliant.toLocaleString()}
                      </td>
                      <td style={{ ...styles.td, color: s.non_compliant > 0 ? "var(--red)" : "var(--muted)", fontWeight: 600 }}>
                        {s.non_compliant.toLocaleString()}
                      </td>
                      <td style={styles.td}>
                        <CoverageBar pct={pct} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.filterIndicator}>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              style={styles.clearFilterBtn}
              title="Quitar filtro"
            >
              <span>{labelForFilter(filter)} · {filtered.length.toLocaleString()}</span>
              <span style={styles.clearX}>✕</span>
            </button>
          )}
        </div>

        <div style={styles.toolbarRight}>
          <select
            style={styles.select}
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
          >
            <option value="all">Todos los servicios</option>
            {services.map((s) => (
              <option key={s.service} value={s.service}>
                {s.service} ({s.total})
              </option>
            ))}
          </select>
          <input
            style={styles.searchInput}
            placeholder="🔍 Buscar ARN o valor de tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Results table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Recurso (ARN)", "Servicio", "Tipo", "Región", "Tag value", "Estado"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...styles.td, textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  Sin resultados para el filtro actual
                </td>
              </tr>
            ) : (
              filtered.slice(0, 500).map((r) => (
                <tr key={r.arn} style={styles.trHover}>
                  <td style={{ ...styles.td, fontFamily: "ui-monospace, monospace", fontSize: 11, wordBreak: "break-all", maxWidth: 480 }}>
                    {r.arn}
                  </td>
                  <td style={styles.td}>{r.service}</td>
                  <td style={styles.td}>{r.resource_type}</td>
                  <td style={styles.td}>{r.region || "—"}</td>
                  <td style={styles.td}>
                    {r.tag_value ? (
                      <code style={styles.code}>{r.tag_value}</code>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div style={styles.footnote}>
          Mostrando <strong>{Math.min(filtered.length, 500).toLocaleString()}</strong>
          {filtered.length > 500 && " (limitado)"}
          {" "}de {results.length.toLocaleString()} recursos
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.filterBtn,
        background: active ? "var(--accent)" : (hover ? "var(--accent-soft)" : "var(--surface)"),
        color: active ? "#fff" : (hover ? "var(--accent)" : "var(--text-2)"),
        borderColor: active ? "var(--accent)" : "var(--border)",
      }}
    >
      {children}
    </button>
  );
}

function CoverageBar({ pct }) {
  const color = coverageColor(pct);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160 }}>
      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width var(--t-base)" }} />
      </div>
      <span style={{ fontSize: 12, color, minWidth: 38, textAlign: "right", fontWeight: 600 }}>{pct}%</span>
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

function Panel({ title, children }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>{title}</div>
      {children}
    </div>
  );
}

function Pill({ label, accent, color }) {
  // `color` (ej. color de ambiente) tiene prioridad: pinta texto, borde y un fondo tenue.
  // `accent` mantiene el estilo morado original. Sin ninguno: estilo neutro/gris.
  const resolved = color
    ? { background: `${color}1a`, color, border: `1px solid ${color}55` }
    : {
        background: accent ? "var(--accent-soft)" : "var(--surface-2)",
        color: accent ? "var(--accent)" : "var(--muted)",
        border: `1px solid ${accent ? "transparent" : "var(--border)"}`,
      };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: color ? 700 : 500,
        ...resolved,
      }}
    >
      {label}
    </span>
  );
}

function coverageColor(pct) {
  if (pct >= 95) return "var(--green)";
  if (pct >= 70) return "var(--yellow)";
  return "var(--red)";
}

function labelForFilter(filter) {
  if (filter === "Non-compliant") return "Sin tag";
  if (filter === "Compliant") return "Con tag";
  return filter;
}

function labelFor(filter) {
  if (filter === "all") return "Todos";
  if (filter === "Non-compliant") return "Sin tag";
  if (filter === "Compliant") return "Con tag";
  return filter;
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
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
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
  cardValue: { fontSize: 28, fontWeight: 700, lineHeight: 1 },
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
  toolbarRight: { display: "flex", gap: 8, flexWrap: "wrap" },
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
    width: 260,
    transition: "border-color var(--t-fast), box-shadow var(--t-fast)",
  },
  select: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    cursor: "pointer",
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
  activeFilterBadge: {
    marginLeft: 8,
    padding: "1px 7px",
    background: "var(--accent-soft)",
    color: "var(--accent)",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".05em",
  },
  footnote: {
    color: "var(--muted)",
    fontSize: 12,
    marginTop: 12,
    textAlign: "right",
  },
};
