import { useState } from "react";
import TrendChart from "./TrendChart.jsx";
import ActivityHeatmap from "./ActivityHeatmap.jsx";

/**
 * Panel colapsable que alterna entre:
 *  - Tendencia 30 días (gráfico de líneas)
 *  - Calendario 12 meses (heatmap)
 */
export default function InsightsPanel({ reports, scriptId, accent, accountFilter }) {
  const [view, setView] = useState("trend");
  const [collapsed, setCollapsed] = useState(false);

  if (reports.length === 0) return null;

  return (
    <div className="insights-panel">
      <div className="insights-panel__header">
        <button
          type="button"
          className="insights-panel__title-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expandir" : "Colapsar"}
        >
          <span className="insights-panel__chevron" data-collapsed={collapsed}>▸</span>
          <span>Insights</span>
        </button>

        {!collapsed && (
          <div className="insights-panel__tabs">
            <ViewTab
              active={view === "trend"}
              onClick={() => setView("trend")}
              accent={accent}
            >
              📈 Tendencia 30d
            </ViewTab>
            <ViewTab
              active={view === "heatmap"}
              onClick={() => setView("heatmap")}
              accent={accent}
            >
              📅 Calendario 12m
            </ViewTab>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="insights-panel__body">
          {view === "trend" ? (
            <TrendChart reports={reports} scriptId={scriptId} accent={accent} />
          ) : (
            <ActivityHeatmap
              reports={reports}
              scriptId={scriptId}
              account={accountFilter}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ViewTab({ active, onClick, accent, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active ? (accent ?? "var(--accent)") : (hover ? "var(--surface-2)" : "transparent"),
        color: active ? "#fff" : "var(--text-2)",
        border: `1px solid ${active ? (accent ?? "var(--accent)") : "var(--border)"}`,
        borderRadius: 8,
        padding: "5px 12px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all var(--t-fast)",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}
