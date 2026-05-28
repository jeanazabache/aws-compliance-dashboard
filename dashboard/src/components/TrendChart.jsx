import { useMemo, useState } from "react";
import {
  ACCOUNT_ALIASES,
  ACCOUNT_COLORS,
  groupByAccountAndDay,
  getMetricLabel,
  formatMetric,
  dateRange,
  daysAgoUTC,
  todayUTC,
  formatDateLabel,
} from "./insightsHelpers.js";

/**
 * Gráfico SVG de líneas de tendencia, una por cuenta.
 * Eje X: últimos 30 días. Eje Y: cobertura % o GB ingresados.
 */
export default function TrendChart({ reports, scriptId, accent }) {
  const [hoverDay, setHoverDay] = useState(null);

  const { accounts, days, byAccountByDay, yMax, yLabel } = useMemo(() => {
    const startDate = daysAgoUTC(29);
    const endDate = todayUTC();
    const days = dateRange(startDate, endDate);

    const grouped = groupByAccountAndDay(reports, scriptId);
    const accounts = Object.keys(grouped).sort();

    let yMax;
    if (scriptId === "audit_cloudwatch_logs") {
      // Para logs: max observado redondeado para arriba
      let max = 0;
      accounts.forEach((acc) => {
        days.forEach((d) => {
          const cell = grouped[acc][d];
          if (cell && cell.value > max) max = cell.value;
        });
      });
      yMax = Math.max(1, Math.ceil(max * 1.1));
    } else {
      yMax = 100; // coverage 0-100
    }

    return {
      accounts,
      days,
      byAccountByDay: grouped,
      yMax,
      yLabel: getMetricLabel(scriptId),
    };
  }, [reports, scriptId]);

  if (reports.length === 0) {
    return <EmptyChart message="Sin datos suficientes para mostrar tendencia" />;
  }

  // Geometría del SVG (más compacta)
  const W = 1000;
  const H = 160;
  const PAD = { top: 12, right: 16, bottom: 30, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const stepX = innerW / Math.max(1, days.length - 1);

  const xFor = (i) => PAD.left + i * stepX;
  const yFor = (val) => PAD.top + innerH * (1 - val / yMax);

  // Líneas Y de referencia (4 líneas)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: PAD.top + innerH * (1 - t),
    label: scriptId === "audit_cloudwatch_logs"
      ? formatMetric(yMax * t, scriptId)
      : `${Math.round(yMax * t)}%`,
  }));

  // Series por cuenta (puntos + path)
  const series = accounts.map((acc) => {
    const points = days.map((day, i) => {
      const cell = byAccountByDay[acc][day];
      return cell ? { x: xFor(i), y: yFor(cell.value), value: cell.value, day } : null;
    });
    const path = pointsToPath(points);
    return {
      acc,
      color: ACCOUNT_COLORS[acc] ?? ACCOUNT_COLORS.default,
      label: ACCOUNT_ALIASES[acc] ?? (acc === "single" ? "Reportes" : acc),
      points,
      path,
    };
  });

  return (
    <div className="trend-chart">
      <div className="trend-chart__header">
        <div className="trend-chart__title">Tendencia · últimos 30 días</div>
        <div className="trend-chart__legend">
          {series.map((s) => (
            <span key={s.acc} className="trend-chart__legend-item">
              <span
                style={{ background: s.color }}
                className="trend-chart__legend-dot"
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend-chart__svg"
        onMouseLeave={() => setHoverDay(null)}
      >
        {/* Grid horizontal */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="#e5e7eb"
              strokeDasharray={i === 0 ? "0" : "2 4"}
            />
            <text
              x={PAD.left - 6}
              y={t.y + 3}
              fontSize="11"
              fill="#6b7280"
              textAnchor="end"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Eje X labels (cada 5 días) */}
        {days.map((day, i) => {
          if (i % 5 !== 0 && i !== days.length - 1) return null;
          return (
            <text
              key={day}
              x={xFor(i)}
              y={H - PAD.bottom + 18}
              fontSize="11"
              fill="#6b7280"
              textAnchor="middle"
            >
              {day.slice(5)}
            </text>
          );
        })}

        {/* Hover guide */}
        {hoverDay !== null && (
          <line
            x1={xFor(hoverDay)}
            x2={xFor(hoverDay)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke={accent ?? "#4f46e5"}
            strokeOpacity="0.3"
            strokeDasharray="3 3"
          />
        )}

        {/* Hover hit areas (transparentes, una por día) */}
        {days.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={xFor(i) - stepX / 2}
            y={PAD.top}
            width={stepX}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverDay(i)}
          />
        ))}

        {/* Líneas (path) */}
        {series.map((s) => (
          <path
            key={s.acc}
            d={s.path}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Puntos (solo donde hay datos) */}
        {series.flatMap((s) =>
          s.points
            .map((p, i) => p && (
              <circle
                key={`${s.acc}-${i}`}
                cx={p.x}
                cy={p.y}
                r={hoverDay === i ? 5 : 3}
                fill={s.color}
                stroke="#fff"
                strokeWidth="1.5"
                style={{ transition: "r var(--t-fast)" }}
              />
            ))
            .filter(Boolean),
        )}
      </svg>

      {/* Tooltip */}
      {hoverDay !== null && (
        <div className="trend-chart__tooltip">
          <div className="trend-chart__tooltip-date">
            {formatDateLabel(days[hoverDay])}
          </div>
          {series.map((s) => {
            const point = s.points[hoverDay];
            return (
              <div key={s.acc} className="trend-chart__tooltip-row">
                <span
                  style={{ background: s.color }}
                  className="trend-chart__legend-dot"
                />
                <span style={{ flex: 1 }}>{s.label}:</span>
                <strong>
                  {point ? formatMetric(point.value, scriptId) : "—"}
                </strong>
              </div>
            );
          })}
          <div className="trend-chart__tooltip-axis">{yLabel}</div>
        </div>
      )}
    </div>
  );
}

function pointsToPath(points) {
  // Une solo puntos consecutivos (no atraviesa "huecos" de días sin datos).
  let path = "";
  let inSegment = false;
  points.forEach((p) => {
    if (!p) {
      inSegment = false;
      return;
    }
    if (!inSegment) {
      path += `M ${p.x} ${p.y} `;
      inSegment = true;
    } else {
      path += `L ${p.x} ${p.y} `;
    }
  });
  return path.trim();
}

function EmptyChart({ message }) {
  return (
    <div className="trend-chart trend-chart--empty">
      <span style={{ fontSize: 28, opacity: 0.4 }}>📊</span>
      <span>{message}</span>
    </div>
  );
}
