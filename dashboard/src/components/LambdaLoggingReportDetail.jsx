import { useState, useMemo, useEffect } from "react";
import StatusBadge from "./StatusBadge.jsx";
import { accountColor } from "./insightsHelpers.js";

const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATUS_COLORS = {
  Habilitado: "var(--green)",
  Deshabilitado: "var(--red)",
};

export default function LambdaLoggingReportDetail({ report }) {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");

  const {
    summary,
    results = [],
    regions = [],
    timestamp,
    account_id,
  } = report;

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return results
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => regionFilter === "all" || r.region === regionFilter)
      .filter(
        (r) =>
          !term ||
          r.function_name.toLowerCase().includes(term) ||
          r.role_name.toLowerCase().includes(term) ||
          (r.detail || "").toLowerCase().includes(term),
      );
  }, [results, statusFilter, regionFilter, search]);

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
    ? Math.round((summary.compliant / summary.total) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={styles.reportHeader}>
        <div>
          <div style={styles.reportTitle}>Lambda — CloudWatch Logging</div>
          <div style={styles.reportMeta}>
            <Pill label={formatDate(timestamp)} />
            <Pill
              label={`Cuenta ${ACCOUNT_ALIASES[account_id] ?? account_id}`}
              color={accountColor(account_id)}
            />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={styles.cards}>
        <SummaryCard
          value={summary.total.toLocaleString()}
          label="Lambdas auditadas"
          color="var(--blue)"
          active={statusFilter === "all"}
          onClick={() => { setStatusFilter("all"); setPage(1); }}
        />
        <SummaryCard
          value={(summary.habilitado ?? 0).toLocaleString()}
          label="Habilitado"
          color="var(--green)"
          active={statusFilter === "Habilitado"}
          onClick={() => toggleStatus("Habilitado")}
        />
        <SummaryCard
          value={(summary.deshabilitado ?? 0).toLocaleString()}
          label="Deshabilitado"
          color="var(--red)"
          active={statusFilter === "Deshabilitado"}
          onClick={() => toggleStatus("Deshabilitado")}
        />
      </div>

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
          {regionFilter !== "all" && (
            <button onClick={() => { setRegionFilter("all"); setPage(1); }} style={styles.clearFilterBtn}>
              <span>{regionFilter}</span><span style={styles.clearX}>✕</span>
            </button>
          )}
        </div>
        <input
          style={styles.searchInput}
          placeholder="🔍 Buscar función o rol…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Results table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Función", "Runtime", "Región", "Rol", "Estado"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...styles.td, textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  Sin resultados para el filtro actual
                </td>
              </tr>
            ) : (
              pageItems.map((r) => (
                <tr key={`${r.region}::${r.function_arn}`} style={styles.trHover}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600 }}>{r.function_name}</div>
                    {r.log_group && (
                      <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                        {r.log_group}
                      </div>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.runtimeTag}>{r.runtime}</span>
                  </td>
                  <td style={styles.td}>{r.region}</td>
                  <td style={{ ...styles.td, fontFamily: "ui-monospace, monospace", fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={r.role_name}>
                    {r.role_name}
                  </td>
                  <td style={styles.td}>
                    <StatusPill status={r.status} />
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

function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || "var(--muted)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
      background: `${color}18`, color, border: `1px solid ${color}55`,
      whiteSpace: "nowrap",
    }}>
      {status}
    </span>
  );
}

function BoolBadge({ value, labelYes = "✓ Sí", labelNo = "✗ No", invert = false }) {
  const isGood = invert ? !value : value;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
      background: value ? (invert ? "var(--red-soft, #fee2e2)" : "var(--green-soft, #d1fae5)") : "var(--surface-2)",
      color: value ? (invert ? "#b91c1c" : "#047857") : "var(--muted)",
      border: `1px solid ${value ? (invert ? "#fecaca" : "#6ee7b7") : "var(--border)"}`,
    }}>
      {value ? labelYes : labelNo}
    </span>
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
        <PageButton disabled={page === 1} onClick={() => onChange(1)}>⏮</PageButton>
        <PageButton disabled={page === 1} onClick={() => onChange(page - 1)}>‹</PageButton>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e-${i}`} style={styles.pageEllipsis}>…</span>
          ) : (
            <PageButton key={p} active={p === page} onClick={() => onChange(p)}>{p}</PageButton>
          )
        )}
        <PageButton disabled={page === totalPages} onClick={() => onChange(page + 1)}>›</PageButton>
        <PageButton disabled={page === totalPages} onClick={() => onChange(totalPages)}>⏭</PageButton>
      </div>
    </div>
  );
}

function PageButton({ children, active, disabled, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 32, height: 32, padding: "0 10px",
        background: active ? "var(--accent)" : (hover && !disabled ? "var(--accent-soft)" : "var(--surface)"),
        color: active ? "#fff" : (disabled ? "var(--border-strong)" : (hover ? "var(--accent)" : "var(--text-2)")),
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13, fontWeight: active ? 700 : 500, fontFamily: "inherit",
        transition: "all var(--t-fast)",
      }}
    >{children}</button>
  );
}

function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((p, idx) => { if (idx > 0 && p - sorted[idx - 1] > 1) result.push("…"); result.push(p); });
  return result;
}

function FilterButton({ active, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...styles.filterBtn, background: active ? "var(--accent)" : (hover ? "var(--accent-soft)" : "var(--surface)"),
        color: active ? "#fff" : (hover ? "var(--accent)" : "var(--text-2)"), borderColor: active ? "var(--accent)" : "var(--border)" }}>
      {children}
    </button>
  );
}

function SummaryCard({ value, label, color, active, onClick }) {
  const [hover, setHover] = useState(false);
  const isClickable = !!onClick;
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} disabled={!isClickable}
      style={{ ...styles.card, cursor: isClickable ? "pointer" : "default", textAlign: "left", fontFamily: "inherit", outline: "none",
        borderColor: active ? color : "var(--border)", borderWidth: active ? 2 : 1, padding: active ? "15px 17px" : "16px 18px",
        background: active ? `${color}10` : "var(--surface)",
        boxShadow: active ? `0 0 0 3px ${color}22, var(--shadow)` : (hover && isClickable ? "var(--shadow)" : "var(--shadow-sm)"),
        transform: hover && isClickable && !active ? "translateY(-1px)" : "translateY(0)", transition: "all var(--t-fast)" }}>
      <div style={{ ...styles.cardValue, color }}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </button>
  );
}

function Panel({ title, children }) {
  return (<div style={styles.panel}><div style={styles.panelTitle}>{title}</div>{children}</div>);
}

function Pill({ label, color }) {
  const resolved = color
    ? { background: `${color}1a`, color, border: `1px solid ${color}55` }
    : { background: "var(--surface-2)", color: "var(--muted)", border: "1px solid var(--border)" };
  return (<span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: color ? 700 : 500, ...resolved }}>{label}</span>);
}

function coverageColor(pct) { if (pct >= 95) return "var(--green)"; if (pct >= 70) return "var(--yellow)"; return "var(--red)"; }

function formatDate(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ts; }
}

const styles = {
  reportHeader: { marginBottom: 20 },
  reportTitle: { fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--text)" },
  reportMeta: { display: "flex", gap: 8, flexWrap: "wrap" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 20 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 18px", transition: "all var(--t-fast)" },
  cardValue: { fontSize: 28, fontWeight: 700, lineHeight: 1.1 },
  cardLabel: { fontSize: 12, color: "var(--muted)", marginTop: 6 },
  panel: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18, marginBottom: 20, boxShadow: "var(--shadow-sm)" },
  panelTitle: { fontWeight: 700, fontSize: 13, marginBottom: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: ".05em" },
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  filterGroup: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  toolbarLabel: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", marginRight: 4 },
  filterBtn: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all var(--t-fast)" },
  clearFilterBtn: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all var(--t-fast)", marginLeft: 8 },
  clearX: { fontSize: 11, opacity: 0.7 },
  searchInput: { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", width: 260 },
  typeCard: { display: "flex", flexDirection: "column", gap: 4, padding: "12px 18px", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "all var(--t-fast)" },
  runtimeTag: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" },
  deniedRoleTag: { fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6, background: "#fee2e2", border: "1px solid #fecaca", color: "#b91c1c", fontFamily: "ui-monospace, monospace" },
  tableWrap: { background: "var(--surface)", borderRadius: "var(--radius)", overflow: "auto", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" },
  trHover: { borderBottom: "1px solid var(--border)", transition: "background var(--t-fast)" },
  td: { padding: "12px 16px", fontSize: 13, color: "var(--text-2)" },
  activeFilterBadge: { marginLeft: 8, padding: "1px 7px", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16, flexWrap: "wrap" },
  paginationInfo: { color: "var(--muted)", fontSize: 12 },
  paginationControls: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  pageEllipsis: { color: "var(--muted)", fontSize: 13, padding: "0 4px", userSelect: "none" },
};
