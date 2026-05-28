import { useMemo, useState } from "react";
import {
  ACCOUNT_ALIASES,
  groupByAccountAndDay,
  formatMetric,
  heatColor,
  formatDateLabel,
  daysAgoUTC,
  todayUTC,
  dateRange,
} from "./insightsHelpers.js";

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DOW_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

/**
 * Calendario tipo GitHub contributions.
 * - Semanas como columnas (52 columnas)
 * - Días de la semana como filas (7 filas, lunes arriba)
 * - Color por celda según valor del audit ese día
 */
export default function ActivityHeatmap({ reports, scriptId, account }) {
  const [hover, setHover] = useState(null);

  const { weeks, byDay, accountsAvailable, maxValue } = useMemo(() => {
    // Rango: hoy hacia atrás 365 días, redondeado al lunes anterior para que la primera columna empiece bien
    const end = todayUTC();
    const start = daysAgoUTC(364);
    // Avanzar start hacia atrás hasta el lunes anterior
    const dow = (start.getUTCDay() + 6) % 7; // 0=lunes...6=domingo
    start.setUTCDate(start.getUTCDate() - dow);

    const all = dateRange(start, end);

    // Agrupar por cuenta y día
    const grouped = groupByAccountAndDay(reports, scriptId);
    const accountsAvailable = Object.keys(grouped).sort();

    // Determinar qué cuenta mostrar
    let target;
    if (account === "all" || !account) {
      // Si "all": tomamos el promedio del día entre cuentas
      target = null;
    } else {
      target = account;
    }

    const byDay = {};
    let maxValue = 0;
    all.forEach((day) => {
      if (target === null) {
        // Promedio si hay datos de varias cuentas el mismo día
        const vals = accountsAvailable
          .map((a) => grouped[a]?.[day]?.value)
          .filter((v) => v != null);
        if (vals.length > 0) {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          byDay[day] = avg;
          if (avg > maxValue) maxValue = avg;
        }
      } else {
        const v = grouped[target]?.[day]?.value;
        if (v != null) {
          byDay[day] = v;
          if (v > maxValue) maxValue = v;
        }
      }
    });

    // Particionar en semanas (cada 7 días = 1 columna)
    const weeks = [];
    for (let i = 0; i < all.length; i += 7) {
      weeks.push(all.slice(i, i + 7));
    }

    return { weeks, byDay, accountsAvailable, maxValue };
  }, [reports, scriptId, account]);

  if (reports.length === 0) {
    return (
      <div className="heatmap heatmap--empty">
        <span style={{ fontSize: 28, opacity: 0.4 }}>📅</span>
        <span>Sin datos suficientes para mostrar el calendario</span>
      </div>
    );
  }

  // Calcular labels de mes (centrados sobre la primera semana de cada mes)
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((week, weekIdx) => {
    const firstDay = week[0];
    if (!firstDay) return;
    const month = parseInt(firstDay.slice(5, 7), 10) - 1;
    if (month !== lastMonth) {
      monthLabels.push({ weekIdx, label: MONTHS_SHORT[month] });
      lastMonth = month;
    }
  });

  const cellSize = 12;
  const cellGap = 2;
  const stepX = cellSize + cellGap;
  const stepY = cellSize + cellGap;

  return (
    <div className="heatmap">
      <div className="heatmap__header">
        <div className="heatmap__title">Calendario · últimos 12 meses</div>
        {accountsAvailable.length > 1 && (
          <div className="heatmap__hint">
            {account === "all" || !account
              ? "Mostrando promedio de todas las cuentas"
              : `Cuenta: ${ACCOUNT_ALIASES[account] ?? account}`}
          </div>
        )}
      </div>

      <div className="heatmap__scroll">
        <svg
          width={weeks.length * stepX + 40}
          height={7 * stepY + 30}
          className="heatmap__svg"
          onMouseLeave={() => setHover(null)}
        >
          {/* Labels de mes (arriba) */}
          {monthLabels.map((m, i) => (
            <text
              key={`m-${i}`}
              x={40 + m.weekIdx * stepX}
              y={10}
              fontSize="10"
              fill="#6b7280"
            >
              {m.label}
            </text>
          ))}

          {/* Labels días de la semana (izquierda) */}
          {DOW_LABELS.map((dow, idx) => {
            // Mostrar solo lunes, miércoles, viernes para no saturar
            if (idx !== 0 && idx !== 2 && idx !== 4) return null;
            return (
              <text
                key={`d-${idx}`}
                x={32}
                y={20 + idx * stepY + cellSize - 2}
                fontSize="9"
                fill="#9ca3af"
                textAnchor="end"
              >
                {dow}
              </text>
            );
          })}

          {/* Celdas */}
          {weeks.map((week, weekIdx) =>
            week.map((day, dayIdx) => {
              const value = byDay[day];
              const x = 40 + weekIdx * stepX;
              const y = 20 + dayIdx * stepY;
              const isHover = hover && hover.day === day;
              return (
                <rect
                  key={day}
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill={heatColor(value, scriptId, maxValue)}
                  stroke={isHover ? "#1f2937" : "rgba(0,0,0,0.04)"}
                  strokeWidth={isHover ? 1.5 : 1}
                  onMouseEnter={() => setHover({ day, value, x, y })}
                  style={{ cursor: "pointer", transition: "stroke var(--t-fast)" }}
                />
              );
            }),
          )}
        </svg>
      </div>

      {/* Leyenda + tooltip */}
      <div className="heatmap__footer">
        <div className="heatmap__legend">
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            {scriptId === "audit_cloudwatch_logs" ? "Menos ingesta" : "Menor cobertura"}
          </span>
          <Swatch color="#fca5a5" />
          <Swatch color="#fdba74" />
          <Swatch color="#fde68a" />
          <Swatch color="#6ee7b7" />
          <Swatch color="#10b981" />
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            {scriptId === "audit_cloudwatch_logs" ? "Más ingesta" : "Mayor cobertura"}
          </span>
        </div>

        {hover && (
          <div className="heatmap__tooltip">
            <strong>{formatDateLabel(hover.day)}</strong>
            {": "}
            {hover.value != null
              ? formatMetric(hover.value, scriptId)
              : <span style={{ color: "var(--muted)" }}>sin datos</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Swatch({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        background: color,
        borderRadius: 2,
        border: "1px solid rgba(0,0,0,0.04)",
      }}
    />
  );
}
