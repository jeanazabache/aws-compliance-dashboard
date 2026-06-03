import { useState, useMemo, useEffect } from "react";
import StatusBadge from "./StatusBadge.jsx";
import { accountColor } from "./insightsHelpers.js";

const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function CloudwatchLogsReportDetail({ report }) {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [retentionFilter, setRetentionFilter] = useState("all");

  const toggleRetention = (key) =>
    setRetentionFilter((curr) => (curr === key ? "all" : key));

  const {
    summary,
    results = [],
    regions = [],
    timestamp,
    account_id,
    lookback_days,
    ingest_cost_usd_per_gb,
  } = report;

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return results
      .filter((r) => regionFilter === "all" || r.region === regionFilter)
      .filter((r) => {
        if (retentionFilter === "all") return true;
        if (retentionFilter === "no-retention") return r.retention_days == null;
        if (retentionFilter === "with-retention") return r.retention_days != null;
        return true;
      })
      .filter((r) => !term || r.name.toLowerCase().includes(term));
  }, [results, search, regionFilter, retentionFilter]);

  // El backend ya ordena por incoming_bytes desc.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  // Reset a página 1 si cambian los filtros y la actual queda fuera de rango.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [filtered.length, pageSize, page, totalPages]);

  // Para barras de proporción contra el máximo absoluto (no solo de la página actual,
  // así la barra del #1 global siempre se ve llena).
  const maxBytes = filtered.reduce((m, r) => Math.max(m, r.incoming_bytes), 0) || 1;

  return (
    <div>
      {/* Header */}
      <div style={styles.reportHeader}>
        <div>
          <div style={styles.reportTitle}>CloudWatch Logs · top ingesta</div>
          <div style={styles.reportMeta}>
            <Pill label={formatDate(timestamp)} />
            <Pill
              label={`Cuenta ${ACCOUNT_ALIASES[account_id] ?? account_id}`}
              color={accountColor(account_id)}
            />
            <Pill label={`Últimos ${lookback_days} días`} />
            <Pill label={`$${ingest_cost_usd_per_gb}/GB`} />
          </div>
        </div>
      </div>

      {/* Summary cards (algunas clickeables = filtros) */}
      <div style={styles.cards}>
        <SummaryCard
          value={summary.total.toLocaleString()}
          label="Log groups"
          color="var(--blue)"
          active={retentionFilter === "all"}
          onClick={() => setRetentionFilter("all")}
        />
        <SummaryCard
          value={formatBytes(summary.total_incoming_bytes)}
          label={`Ingesta (${lookback_days}d)`}
          color="var(--accent)"
        />
        <SummaryCard
          value={summary.total_incoming_events.toLocaleString()}
          label="Eventos ingestados"
          color="var(--accent-2)"
        />
        <SummaryCard
          value={`$${summary.estimated_cost_usd.toLocaleString()}`}
          label="Costo estimado USD"
          color={summary.estimated_cost_usd > 100 ? "var(--red)" : "var(--green)"}
        />
        <SummaryCard
          value={summary.needs_action.toLocaleString()}
          label="Sin retention"
          color={summary.needs_action > 0 ? "var(--yellow)" : "var(--green)"}
          active={retentionFilter === "no-retention"}
          onClick={() => toggleRetention("no-retention")}
        />
        <SummaryCard
          value={formatBytes(summary.total_stored_bytes)}
          label="Almacenado"
          color="var(--muted)"
        />
      </div>

      {/* Regions breakdown */}
      {regions.length > 0 && (
        <Panel title="Ingesta por región">
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Región", "Log groups", "Ingesta", "Eventos", "Costo USD"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr
                    key={r.region}
                    style={{ ...styles.trHover, cursor: "pointer" }}
                    onClick={() => setRegionFilter(r.region === regionFilter ? "all" : r.region)}
                    title="Click para filtrar la tabla por esta región"
                  >
                    <td style={{ ...styles.td, fontWeight: 600 }}>
                      {r.region}
                      {r.region === regionFilter && (
                        <span style={styles.activeFilterBadge}>filtrado</span>
                      )}
                    </td>
                    <td style={styles.td}>{r.log_groups.toLocaleString()}</td>
                    <td style={{ ...styles.td, fontWeight: 600, color: "var(--accent)" }}>
                      {formatBytes(r.incoming_bytes)}
                    </td>
                    <td style={styles.td}>{r.incoming_events.toLocaleString()}</td>
                    <td style={{ ...styles.td, fontWeight: 600, color: r.estimated_cost_usd > 10 ? "var(--red)" : "var(--text-2)" }}>
                      ${r.estimated_cost_usd.toFixed(2)}
                    </td>
                  </tr>
                ))}
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
          {retentionFilter === "no-retention" && (
            <button
              onClick={() => setRetentionFilter("all")}
              style={styles.clearFilterBtn}
              title="Quitar filtro Sin retention"
            >
              <span>Sin retention · {filtered.length.toLocaleString()}</span>
              <span style={styles.clearX}>✕</span>
            </button>
          )}
        </div>

        <div style={styles.toolbarRight}>
          <select
            style={styles.select}
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
          >
            <option value="all">Todas las regiones</option>
            {regions.map((r) => (
              <option key={r.region} value={r.region}>
                {r.region}
              </option>
            ))}
          </select>
          <input
            style={styles.searchInput}
            placeholder="🔍 Buscar log group…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Top ranking */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["#", "Log group", "Región", "Ingesta", "Eventos", "Retention", "Costo USD", "Estado"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...styles.td, textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  Sin resultados para el filtro actual
                </td>
              </tr>
            ) : (
              pageItems.map((r, idx) => {
                const globalRank = startIdx + idx + 1;
                const pct = (r.incoming_bytes / maxBytes) * 100;
                return (
                  <tr key={`${r.region}::${r.name}`} style={styles.trHover}>
                    <td style={{ ...styles.td, color: "var(--muted)", fontWeight: 600, width: 36 }}>
                      {globalRank}
                    </td>
                    <td style={{ ...styles.td, fontFamily: "ui-monospace, monospace", fontSize: 12, wordBreak: "break-all", maxWidth: 380 }}>
                      {r.name}
                    </td>
                    <td style={styles.td}>{r.region}</td>
                    <td style={styles.td}>
                      <BytesBar bytes={r.incoming_bytes} pct={pct} />
                    </td>
                    <td style={styles.td}>{r.incoming_events.toLocaleString()}</td>
                    <td style={styles.td}>
                      {r.retention_days == null ? (
                        <span style={{ color: "var(--red)", fontWeight: 600 }}>∞ Never</span>
                      ) : (
                        <span style={{ color: "var(--text-2)" }}>{r.retention_days}d</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, fontWeight: 600, color: r.estimated_cost_usd > 1 ? "var(--red)" : "var(--text-2)" }}>
                      ${r.estimated_cost_usd.toFixed(2)}
                    </td>
                    <td style={styles.td}>
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                );
              })
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

function Pagination({ page, totalPages, totalItems, totalAll, startIdx, endIdx, onChange }) {
  const pages = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);

  return (
    <div style={styles.pagination}>
      <div style={styles.paginationInfo}>
        Mostrando <strong>{startIdx + 1}</strong>–<strong>{endIdx}</strong> de{" "}
        <strong>{totalItems.toLocaleString()}</strong>
        {totalAll !== totalItems && (
          <> (filtrados de {totalAll.toLocaleString()})</>
        )}
      </div>
      <div style={styles.paginationControls}>
        <PageButton disabled={page === 1} onClick={() => onChange(1)} title="Primera página">⏮</PageButton>
        <PageButton disabled={page === 1} onClick={() => onChange(page - 1)} title="Anterior">‹</PageButton>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} style={styles.pageEllipsis}>…</span>
          ) : (
            <PageButton
              key={p}
              active={p === page}
              onClick={() => onChange(p)}
            >
              {p}
            </PageButton>
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

/**
 * Devuelve [1, 2, 3, "…", 9, 10] tipo lista compacta de páginas.
 * Mantiene siempre visibles: 1, último, current ± 1.
 */
function buildPageList(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((p, idx) => {
    if (idx > 0 && p - sorted[idx - 1] > 1) result.push("…");
    result.push(p);
  });
  return result;
}

function BytesBar({ bytes, pct }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 200 }}>
      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.max(2, pct)}%`,
            height: "100%",
            background: pct > 80 ? "var(--red)" : pct > 40 ? "var(--yellow)" : "var(--accent)",
            transition: "width var(--t-base)",
          }}
        />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 80, textAlign: "right", color: "var(--text-2)" }}>
        {formatBytes(bytes)}
      </span>
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

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
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
  cardValue: { fontSize: 24, fontWeight: 700, lineHeight: 1.1 },
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
  filterGroup: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
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
  clearX: {
    fontSize: 11,
    opacity: 0.7,
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
  toolbarLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".06em",
    color: "var(--muted)",
    marginRight: 4,
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
    flexWrap: "wrap",
  },
  paginationInfo: {
    color: "var(--muted)",
    fontSize: 12,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  pageEllipsis: {
    color: "var(--muted)",
    fontSize: 13,
    padding: "0 4px",
    userSelect: "none",
  },
};
