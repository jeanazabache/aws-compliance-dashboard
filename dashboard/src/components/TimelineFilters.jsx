import { useState, useMemo } from "react";
import { ACCOUNT_ALIASES, ENV_COLORS, ENV_ORDER } from "./insightsHelpers.js";

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
    // Orden por ambiente: DEV → QA → PRD. Cuentas desconocidas van al final.
    return Array.from(unique).sort((a, b) => {
      const ra = ENV_ORDER[ACCOUNT_ALIASES[a]] ?? 99;
      const rb = ENV_ORDER[ACCOUNT_ALIASES[b]] ?? 99;
      return ra - rb;
    });
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
          const alias = ACCOUNT_ALIASES[acc] ?? acc;
          const envColor = ENV_COLORS[alias] ?? accent;
          return (
            <FilterPill
              key={acc}
              active={accountFilter === acc}
              accent={envColor}
              colored
              onClick={() => onAccountChange(acc)}
            >
              {alias}
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

function FilterPill({ active, accent, colored = false, onClick, children }) {
  const [hover, setHover] = useState(false);
  // Para pastillas de ambiente (colored): siempre muestran su color de borde/texto,
  // y se rellenan cuando están activas o en hover. Para "Todas" se mantiene el estilo neutro.
  const showColor = active || (colored && hover);
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
        border: `1px solid ${colored ? accent : active ? accent : "var(--border)"}`,
        background: active
          ? `${accent}14`
          : colored && hover
            ? `${accent}0d`
            : hover
              ? "var(--surface-2)"
              : "var(--surface)",
        color: colored || showColor ? accent : "var(--text-2)",
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
