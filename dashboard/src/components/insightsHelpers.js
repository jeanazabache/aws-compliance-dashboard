// Helpers compartidos para TrendChart y ActivityHeatmap.

export const ACCOUNT_ALIASES = {
  "792654060327": "DEV",
  "503134114226": "PRD",
  "213698163176": "QA",
};

export const ACCOUNT_COLORS = {
  "792654060327": "#4f46e5",
  "503134114226": "#0ea5e9",
  "213698163176": "#10b981",
  default: "#6b7280",
};

/**
 * Extrae el valor numérico relevante de un reporte según el tipo de audit.
 * - Repos / Tags: % de cobertura (compliant / (total - skipped))
 * - CloudWatch Logs: GB ingestados en el periodo
 */
export function getMetric(summary, scriptId) {
  if (scriptId === "audit_cloudwatch_logs") {
    return (summary?.total_incoming_bytes ?? 0) / (1024 ** 3);
  }
  const total = (summary?.total ?? 0) - (summary?.skipped ?? 0);
  if (total <= 0) return 0;
  return Math.round(((summary?.compliant ?? 0) / total) * 100);
}

export function getMetricLabel(scriptId) {
  if (scriptId === "audit_cloudwatch_logs") return "GB ingestados";
  return "Cobertura %";
}

export function formatMetric(value, scriptId) {
  if (scriptId === "audit_cloudwatch_logs") {
    return value < 1 ? `${(value * 1024).toFixed(0)} MB` : `${value.toFixed(1)} GB`;
  }
  return `${Math.round(value)}%`;
}

/**
 * Dado el array completo de reportes de un tipo, devuelve un map:
 *   { account_id_or_'single': { 'YYYY-MM-DD': value, ... } }
 * Si hay varios reportes el mismo día para la misma cuenta, gana el más reciente.
 */
export function groupByAccountAndDay(reports, scriptId) {
  const grouped = {};
  reports.forEach((r) => {
    const acc = r.account_id ?? "single";
    const day = (r.timestamp || "").slice(0, 10);
    if (!day) return;
    grouped[acc] = grouped[acc] ?? {};
    const value = getMetric(r.summary, scriptId);
    // Si ya hay valor para ese día, nos quedamos con el timestamp mayor (más reciente).
    const existing = grouped[acc][day];
    if (!existing || r.timestamp > existing.timestamp) {
      grouped[acc][day] = { value, timestamp: r.timestamp };
    }
  });
  return grouped;
}

/**
 * Genera array de fechas YYYY-MM-DD desde startDate hasta endDate (inclusive), UTC.
 */
export function dateRange(startDate, endDate) {
  const out = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function daysAgoUTC(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Color para celda del heatmap según valor y tipo de audit.
 * Para coverage %: rojo→amarillo→verde (más alto = mejor).
 * Para logs GB: verde→amarillo→rojo (más alto = peor).
 */
export function heatColor(value, scriptId, maxValue = 100) {
  if (value == null) return "#f1f5f9"; // gris claro: sin datos

  if (scriptId === "audit_cloudwatch_logs") {
    // Escala "menos es mejor" basada en el max observado de la serie.
    const ratio = Math.min(1, value / Math.max(maxValue, 0.1));
    if (ratio < 0.2) return "#a7f3d0";
    if (ratio < 0.4) return "#fde68a";
    if (ratio < 0.7) return "#fdba74";
    return "#fca5a5";
  }

  // Coverage % — más alto = mejor
  if (value >= 95) return "#10b981";
  if (value >= 85) return "#6ee7b7";
  if (value >= 70) return "#fde68a";
  if (value >= 50) return "#fdba74";
  return "#fca5a5";
}

export function formatDateLabel(isoDate) {
  try {
    return new Date(isoDate + "T12:00:00Z").toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
