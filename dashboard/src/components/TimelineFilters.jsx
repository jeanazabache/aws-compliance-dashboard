import { useState, useMemo } from "react";

const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

/**
 * Filtros para el timeline (solo auditorías multi-cuenta).
 * - Cuenta: pastillas con DEV / PRD / QA (single select).
 * - Fecha: input de día. Filtra a reportes cuyo timestamp cae en ese día (UTC).
 */
export default function TimelineFilters({
  reports,
  accountFilter,
  dateFilter,
  onAccountChange,
  onDateChange,
  accent,
}) {
  const accounts = useMemo(() => {
    const unique = new Set();
    reports.forEach((r) => r.account_id && unique.add(r.account_id));
    return Array.from(unique).sort();
  }, [reports]);

  const totalAfterAccount = useMemo(() => {
    if (accountFilter === "all") return reports.length;
    return reports.filter((r) => r.account_id === accountFilter).length;
  }, [reports, accountFilter]);

  if (accounts.length === 0) {
    // Sin account_id en los reportes (auditoría single-account): solo fila de fecha.
    return (
      <div className="timeline-filters">
        <div className="timeline-filters__row">
          <span className="timeline-filters__label">Fecha:</span>
          <input
            type="date"
            className="timeline-filters__date"
            value={dateFilter ?? ""}
            onChange={(e) => onDateChange(e.target.value || null)}
          />
          {dateFilter && (
            <button
              type="button"
              className="timeline-filters__clear"
              onClick={() => onDateChange(null)}
              title="Limpiar filtro de fecha"
            >
              ✕
            </button>
          )}
          <span className="timeline-filters__hint">
            {totalAfterAccount} reportes
            {dateFilter ? ` el ${dateFilter}` : " en total"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-filters">
      <div className="timeline-filters__row">
        <span className="timeline-filters__label">Cuenta:</span>
        <FilterPill
          active={accountFilter === "all"}
          accent={accent}
          onClick={() => onAccountChange("all")}
        >
          Todas
          <span className="timeline-filters__count">{reports.length}</span>
        </FilterPill>
        {accounts.map((acc) => {
          const count = reports.filter((r) => r.account_id === acc).length;
          return (
            <FilterPill
              key={acc}
              active={accountFilter === acc}
              accent={accent}
              onClick={() => onAccountChange(acc)}
            >
              {ACCOUNT_ALIASES[acc] ?? acc}
              <span className="timeline-filters__count">{count}</span>
            </FilterPill>
          );
        })}
      </div>

      <div className="timeline-filters__row">
        <span className="timeline-filters__label">Fecha:</span>
        <input
          type="date"
          className="timeline-filters__date"
          value={dateFilter ?? ""}
          onChange={(e) => onDateChange(e.target.value || null)}
        />
        {dateFilter && (
          <button
            type="button"
            className="timeline-filters__clear"
            onClick={() => onDateChange(null)}
            title="Limpiar filtro de fecha"
          >
            ✕
          </button>
        )}
        <span className="timeline-filters__hint">
          {totalAfterAccount} reportes
          {dateFilter ? ` el ${dateFilter}` : " en total"}
        </span>
      </div>
    </div>
  );
}

function FilterPill({ active, accent, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? accent : "var(--border)"}`,
        background: active ? `${accent}14` : (hover ? "var(--surface-2)" : "var(--surface)"),
        color: active ? accent : "var(--text-2)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all var(--t-fast)",
      }}
    >
      {children}
    </button>
  );
}
