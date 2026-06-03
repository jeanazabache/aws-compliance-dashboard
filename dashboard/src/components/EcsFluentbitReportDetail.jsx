import { useState, useMemo, useEffect } from "react";
import StatusBadge from "./StatusBadge.jsx";
import { accountColor } from "./insightsHelpers.js";

const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Map de filtros de status. "all" = sin filtro.
const STATUS_FILTERS = {
  all: null,
  Compliant: (s) => s === "Compliant",
  "Non-compliant": (s) => s === "Non-compliant",
  Skipped: (s) => s === "Skipped",
};

export default function EcsFluentbitReportDetail({ report }) {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const {
    summary,
    results = [],
    clusters = [],
    timestamp,
    account_id,
    fluentbit_container_name,
  } = report;

  const fbName = fluentbit_container_name || "agent-fluentbit";

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    const matchStatus = STATUS_FILTERS[statusFilter];
    return results
      .filter((r) => !matchStatus || matchStatus(r.status))
      .filter((r) => clusterFilter === "all" || r.cluster === clusterFilter)
      .filter(
        (r) =>
          !term ||
          r.service.toLowerCase().includes(term) ||
          r.cluster.toLowerCase().includes(term),
      );
  }, [results, statusFilter, clusterFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [filtered.length, pageSize, page, totalPages]);

  const toggleStatus = (key) => {
    setStatusFilter((curr) => (curr === key ? "all" : key));
    setPage(1);
  };

  const coverage = summary.total
    ? Math.round((summary.compliant / Math.max(1, summary.total - summary.skipped)) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={styles.reportHeader}>
        <div>
          <div style={styles.reportTitle}>Fluent Bit en servicios ECS</div>
          <div style={styles.reportMeta}>
            <Pill label={formatDate(timestamp)} />
            <Pill
              label={`Cuenta ${ACCOUNT_ALIASES[account_id] ?? account_id}`}
              color={accountColor(account_id)}
            />
            <Pill label={<>sidecar: <code style={styles.code}>{fbName}</code></>} />
          </div>
        </div>
      </div>

      {/* Summary cards (clickeables = filtros) */}
      <div style={styles.cards}>
        <SummaryCard
          value={summary.total.toLocaleString()}
          label="Servicios"
          color="var(--blue)"
          active={statusFilter === "all"}
          onClick={() => { setStatusFilter("all"); setPage(1); }}
        />
        <SummaryCard
          value={summary.compliant.toLocaleString()}
          label="Con Fluent Bit"
          color="var(--green)"
          active={statusFilter === "Compliant"}
          onClick={() => toggleStatus("Compliant")}
        />
        <SummaryCard
          value={summary.needs_action.toLocaleString()}
          label="Sin Fluent Bit"
          color="var(--red)"
          active={statusFilter === "Non-compliant"}
          onClick={() => toggleStatus("Non-compliant")}
        />
        <SummaryCard
          value={summary.skipped.toLocaleString()}
          label="Skipped"
          color="var(--muted)"
          active={statusFilter === "Skipped"}
          onClick={() => toggleStatus("Skipped")}
        />
        <SummaryCard
          value={(summary.clusters ?? clusters.length).toLocaleString()}
          label="Clusters"
          color="var(--accent-2)"
        />
        <SummaryCard
          value={`${coverage}%`}
          label="Cobertura"
          color={coverageColor(coverage)}
        />
      </div>

      {/* Clusters breakdown */}
      {clusters.length > 0 && (
        <Panel title="Cumplimiento por cluster">
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Cluster", "Región", "Servicios", "Con FB", "Sin FB", "Cobertura"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => {
                  const evaluable = c.services - (c.skipped ?? 0);
                  const pct = evaluable > 0 ? Math.round((c.compliant / evaluable) * 100) : 0;
                  const active = c.cluster === clusterFilter;
                  return (
                    <tr
                      key={`${c.region}::${c.cluster}`}
                      style={{ ...styles.trHover, cursor: "pointer" }}
                      onClick={() => { setClusterFilter(active ? "all" : c.cluster); setPage(1); }}
                      title="Click para filtrar la tabla por este cluster"
                    >
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        {c.cluster}
                        {active && <span style={styles.activeFilterBadge}>filtrado</span>}
                      </td>
                      <td style={styles.td}>{c.region}</td>
                      <td style={styles.td}>{c.services}</td>
                      <td style={{ ...styles.td, color: "var(--green)", fontWeight: 600 }}>{c.compliant}</td>
                      <td style={{ ...styles.td, color: c.non_compliant > 0 ? "var(--red)" : "var(--muted)", fontWeight: 600 }}>
                        {c.non_compliant}
                      </td>
                      <td style={styles.td}><CoverageBar pct={pct} /></td>
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
        <div style={styles.filterGroup}>
          <span style={styles.toolbarLabel}>Por página:</span>
          {PAGE_SIZE_OPTIONS.map((n) => (
            <FilterButton
              key={n}
              active={pageSize === n}
              onClick={() => { setPageSize(n); setPage(1); }}
            >
              {n}
            </FilterButton>
          ))}
          {clusterFilter !== "all" && (
            <button
              onClick={() => { setClusterFilter("all"); setPage(1); }}
              style={styles.clearFilterBtn}
              title="Quitar filtro de cluster"
            >
              <span>{clusterFilter} · {filtered.length}</span>
              <span style={styles.clearX}>✕</span>
            </button>
          )}
        </div>

        <input
          style={styles.searchInput}
          placeholder="🔍 Buscar servicio o cluster…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Services table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Cluster", "Servicio", "Región", "Task definition", "Contenedores", "Launch", "Estado"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...styles.td, textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  Sin resultados para el filtro actual
                </td>
              </tr>
            ) : (
              pageItems.map((r) => (
                <tr key={`${r.region}::${r.cluster}::${r.service}`} style={styles.trHover}>
                  <td style={styles.td}>{r.cluster}</td>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{r.service}</td>
                  <td style={styles.td}>{r.region}</td>
                  <td style={{ ...styles.td, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                    {r.task_definition || "—"}
                  </td>
                  <td style={styles.td}>
                    <ContainerList containers={r.containers} highlight={fbName} />
                  </td>
                  <td style={styles.td}>
                    {r.launch_type ? (
                      <span style={styles.launchTag}>{r.launch_type}</span>
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
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={filtered.length}
          totalAll={results.length}
          startIdx={startIdx}
          endIdx={Math.min(startIdx + pageSize, filtered.length)}
          onChange={setPage}
        />
      )}
    </div>
  );
}

function ContainerList({ containers, highlight }) {
  if (!containers || containers.length === 0) {
    return <span style={{ color: "var(--muted)" }}>—</span>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {containers.map((c) => {
        const isFb = c === highlight;
        return (
          <span
            key={c}
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              padding: "1px 7px",
              borderRadius: 999,
              background: isFb ? "var(--green-soft)" : "var(--surface-2)",
              color: isFb ? "#047857" : "var(--text-2)",
              border: `1px solid ${isFb ? "#6ee7b7" : "var(--border)"}`,
              fontWeight: isFb ? 700 : 500,
            }}
          >
            {isFb ? `✓ ${c}` : c}
          </span>
        );
      })}
    </div>
  );
}

function Pagination({ page, totalPages, totalItems, totalAll, startIdx, endIdx, onChange }) {
  const pages = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);
  return (
    <div style={styles.pagination}>
      <div style={styles.paginationInfo}>
        Mostrando <strong>{startIdx + 1}</strong>–<strong>{endIdx}</strong> de{" "}
        <strong>{totalItems.toLocaleString()}</strong>
        {totalAll !== totalItems && <> (filtrados de {totalAll.toLocaleString()})</>}
      </div>
      <div style={styles.paginationControls}>
        <PageButton disabled={page === 1} onClick={() => onChange(1)} title="Primera página">⏮</PageButton>
        <PageButton disabled={page === 1} onClick={() => onChange(page - 1)} title="Anterior">‹</PageButton>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e-${i}`} style={styles.pageEllipsis}>…</span>
          ) : (
            <PageButton key={p} active={p === page} onClick={() => onChange(p)}>{p}</PageButton>
          )
        )}
        <PageButton disabled={page === totalPages} onClick={() => onChange(page + 1)} title="Siguiente">›</PageButton>
        <PageButton disabled={page === totalPages} onClick={() => onChange(totalPages)} title="Última página">⏭</PageButton>
      </div>
    </div>
  );
}

function PageButton({ children, active, disabled, onClick, title }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 32,
        height: 32,
        padding: "0 10px",
        background: active ? "var(--accent)" : (hover && !disabled ? "var(--accent-soft)" : "var(--surface)"),
        color: active ? "#fff" : (disabled ? "var(--border-strong)" : (hover ? "var(--accent)" : "var(--text-2)")),
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        fontFamily: "inherit",
        transition: "all var(--t-fast)",
      }}
    >
      {children}
    </button>
  );
}

function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((p, idx) => {
    if (idx > 0 && p - sorted[idx - 1] > 1) result.push("…");
    result.push(p);
  });
  return result;
}

function CoverageBar({ pct }) {
  const color = coverageColor(pct);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 140 }}>
      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width var(--t-base)" }} />
      </div>
      <span style={{ fontSize: 12, color, minWidth: 38, textAlign: "right", fontWeight: 600 }}>{pct}%</span>
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
  cardValue: { fontSize: 28, fontWeight: 700, lineHeight: 1.1 },
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
  filterGroup: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  toolbarLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".06em",
    color: "var(--muted)",
    marginRight: 4,
  },
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
    marginLeft: 8,
  },
  clearX: { fontSize: 11, opacity: 0.7 },
  searchInput: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    width: 260,
  },
  tableWrap: {
    background: "var(--surface)",
    borderRadius: "var(--radius)",
    overflow: "auto",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)",
    WebkitOverflowScrolling: "touch",
  },
  table: { width: "100%", borderCollapse: "collapse" },
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
  launchTag: {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 4,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text-2)",
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
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
    flexWrap: "wrap",
  },
  paginationInfo: { color: "var(--muted)", fontSize: 12 },
  paginationControls: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  pageEllipsis: { color: "var(--muted)", fontSize: 13, padding: "0 4px", userSelect: "none" },
};
