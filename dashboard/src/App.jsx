import { useState, useEffect, useMemo, useCallback } from "react";
import ReportDetail from "./components/ReportDetail.jsx";
import AuditTypeTabs from "./components/AuditTypeTabs.jsx";
import TimelineFilters from "./components/TimelineFilters.jsx";
import InsightsPanel from "./components/InsightsPanel.jsx";
import { signOut, getUsername, isAuthConfigured } from "./auth/cognito.js";

const INDEX_URL = "./reports/index.json";

// Devuelve el día LOCAL de un timestamp ISO en formato YYYY-MM-DD.
// El <input type="date"> entrega el día en hora local, y la UI muestra
// las fechas en hora local (es-PE), así que el filtro debe comparar contra
// el día local del reporte, no contra el día UTC.
function localDay(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Definición de los tipos de auditoría que entiende el dashboard.
const AUDIT_TYPES = [
  {
    id: "audit_utp_repos",
    label: "Repositorios GitHub",
    description: "Compliance de repos UTPXpedition",
    icon: "🐙",
    accent: "#4f46e5",
  },
  {
    id: "audit_aws_tags",
    label: "Tags en recursos AWS",
    description: "Cobertura del tag t.aplicacion",
    icon: "🏷️",
    accent: "#0ea5e9",
  },
  {
    id: "audit_cloudwatch_logs",
    label: "CloudWatch Logs",
    description: "Top de log groups por ingesta",
    icon: "📊",
    accent: "#f59e0b",
  },
  {
    id: "audit_ecs_fluentbit",
    label: "Fluent Bit en ECS",
    description: "Servicios ECS con sidecar de logging",
    icon: "🚢",
    accent: "#0891b2",
  },
  {
    id: "audit_apigateway_waf",
    label: "API Gateway WAF",
    description: "APIs protegidas con Web ACL (WAF)",
    icon: "🛡️",
    accent: "#7c3aed",
  },
];

export default function App() {
  const [index, setIndex] = useState(null);
  const [activeType, setActiveType] = useState(AUDIT_TYPES[0].id);
  const [selectedPath, setSelectedPath] = useState(null);
  const [report, setReport] = useState(null);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState(null);

  // Filtros aplicados al timeline (solo en auditorías multi-cuenta).
  const [accountFilter, setAccountFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(null); // formato YYYY-MM-DD

  const loadIndex = useCallback(async () => {
    setLoadingIndex(true);
    setError(null);
    try {
      const res = await fetch(`${INDEX_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIndex(data);
    } catch (e) {
      setError(`No se pudo cargar el índice de reportes: ${e.message}`);
    } finally {
      setLoadingIndex(false);
    }
  }, []);

  useEffect(() => { loadIndex(); }, [loadIndex]);

  // Reportes filtrados al tipo de auditoría activo.
  const reportsForType = useMemo(() => {
    if (!index?.reports) return [];
    return index.reports.filter((r) => r.script === activeType);
  }, [index, activeType]);

  const activeTypeMeta = AUDIT_TYPES.find((t) => t.id === activeType);

  // Aplica filtros (cuenta + fecha) al subconjunto del tipo activo.
  const visibleReports = useMemo(() => {
    return reportsForType.filter((r) => {
      if (accountFilter !== "all" && r.account_id !== accountFilter) return false;
      if (dateFilter) {
        // Comparar contra el día LOCAL del timestamp (igual que se muestra en la UI),
        // no contra el día en UTC. Si comparáramos el UTC (slice(0,10)) el filtro
        // fallaría para reportes cuya hora local cae en un día distinto al UTC.
        if (localDay(r.timestamp) !== dateFilter) return false;
      }
      return true;
    });
  }, [reportsForType, accountFilter, dateFilter]);

  // Reset de filtros al cambiar de tipo de auditoría.
  useEffect(() => {
    setAccountFilter("all");
    setDateFilter(null);
  }, [activeType]);

  // Stats agregados por tipo, para mostrar en las tabs.
  // Para audits multi-cuenta: tomamos el reporte más reciente DE CADA CUENTA y sumamos.
  // Así el % es el promedio real entre todas las cuentas, no el de una sola.
  const statsByType = useMemo(() => {
    const stats = {};
    AUDIT_TYPES.forEach((t) => {
      stats[t.id] = { count: 0, latestByAccount: {}, aggregated: null };
    });

    (index?.reports ?? []).forEach((r) => {
      const bucket = stats[r.script];
      if (!bucket) return;
      bucket.count += 1;
      const accKey = r.account_id ?? "single";
      const prev = bucket.latestByAccount[accKey];
      if (!prev || r.timestamp > prev.timestamp) {
        bucket.latestByAccount[accKey] = r;
      }
    });

    // Sumar los summaries de cada cuenta más reciente.
    Object.values(stats).forEach((bucket) => {
      const latests = Object.values(bucket.latestByAccount);
      if (latests.length === 0) return;

      const agg = {
        total: 0,
        compliant: 0,
        needs_action: 0,
        skipped: 0,
        accounts: latests.length,
        latestTimestamp: latests.reduce((m, r) => (r.timestamp > m ? r.timestamp : m), ""),
      };
      latests.forEach((r) => {
        agg.total       += r.summary?.total ?? 0;
        agg.compliant   += r.summary?.compliant ?? 0;
        agg.needs_action += r.summary?.needs_action ?? 0;
        agg.skipped     += r.summary?.skipped ?? 0;
      });
      bucket.aggregated = agg;
    });

    return stats;
  }, [index]);

  // Auto-seleccionar el más reciente del tipo activo cuando cambian.
  useEffect(() => {
    if (visibleReports.length === 0) {
      setSelectedPath(null);
      setReport(null);
      return;
    }
    const stillExists = visibleReports.find((r) => r.path === selectedPath);
    if (!stillExists) {
      setSelectedPath(visibleReports[0].path);
    }
  }, [visibleReports, selectedPath]);

  // Cargar el reporte seleccionado.
  useEffect(() => {
    if (!selectedPath) return;
    setLoadingReport(true);
    setReport(null);
    fetch(`./${selectedPath}?t=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => setReport(data))
      .catch((e) => setError(`No se pudo cargar el reporte: ${e.message}`))
      .finally(() => setLoadingReport(false));
  }, [selectedPath]);

  return (
    <div style={styles.shell}>
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar__left">
          <img src="./utp-logo.svg" alt="UTP" className="topbar__logo" />
          <div className="topbar__title-block">
            <div className="topbar__title">AWS Operaciones &amp; DevOps</div>
            <div className="topbar__subtitle">Auditorías programadas · UTPXpedition</div>
          </div>
        </div>
        <div className="topbar__actions">
          <button className="refresh-btn" onClick={loadIndex} title="Recargar índice">
            <span style={{ fontSize: 14 }}>↺</span>
            <span className="refresh-btn__label">Actualizar</span>
          </button>
          {isAuthConfigured && (
            <button
              className="refresh-btn"
              onClick={() => { signOut(); window.location.reload(); }}
              title={getUsername() ? `Cerrar sesión (${getUsername()})` : "Cerrar sesión"}
            >
              <span style={{ fontSize: 14 }}>⎋</span>
              <span className="refresh-btn__label">Salir</span>
            </button>
          )}
        </div>
      </header>

      <main style={styles.main} className="app-main">
        {error && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Selector de tipo de auditoría */}
        <AuditTypeTabs
          types={AUDIT_TYPES}
          activeType={activeType}
          stats={statsByType}
          loading={loadingIndex}
          onSelect={setActiveType}
        />

        {/* Timeline horizontal de reportes del tipo activo */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionTitle}>
                {activeTypeMeta?.icon} {activeTypeMeta?.label}
              </div>
              <div style={styles.sectionSubtitle}>
                {reportsForType.length === 0
                  ? "Sin reportes para esta auditoría"
                  : visibleReports.length !== reportsForType.length
                    ? `${visibleReports.length} de ${reportsForType.length} reportes (filtrados)`
                    : `${reportsForType.length} reportes históricos`}
              </div>
            </div>
          </div>

          {reportsForType.length > 0 && (
            <TimelineFilters
              reports={reportsForType}
              accountFilter={accountFilter}
              dateFilter={dateFilter}
              onAccountChange={setAccountFilter}
              onDateChange={setDateFilter}
              accent={activeTypeMeta?.accent}
            />
          )}

          {reportsForType.length > 0 && (
            <InsightsPanel
              reports={reportsForType}
              scriptId={activeType}
              accent={activeTypeMeta?.accent}
              accountFilter={accountFilter}
            />
          )}
        </section>

        {/* Detalle del reporte */}
        <section style={styles.section}>
          {loadingReport ? (
            <DetailSkeleton />
          ) : report ? (
            <div className="fade-in-up" key={selectedPath}>
              <ReportDetail report={report} />
            </div>
          ) : !loadingIndex && visibleReports.length === 0 ? (
            <EmptyState
              typeMeta={activeTypeMeta}
              hasFilters={accountFilter !== "all" || !!dateFilter}
              onClearFilters={() => { setAccountFilter("all"); setDateFilter(null); }}
            />
          ) : null}
        </section>
      </main>

      <footer className="app-footer">
        By Jean Azabache Medina
      </footer>
    </div>
  );
}

function EmptyState({ typeMeta, hasFilters, onClearFilters }) {
  return (
    <div style={styles.emptyState}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>{typeMeta?.icon ?? "📭"}</div>
      <div style={styles.emptyTitle}>
        {hasFilters ? "Sin reportes con esos filtros" : "No hay reportes todavía"}
      </div>
      <div style={styles.emptyText}>
        {hasFilters ? (
          <>
            Prueba con otra cuenta o fecha.{" "}
            <button
              onClick={onClearFilters}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                padding: 0,
              }}
            >
              Limpiar filtros
            </button>
          </>
        ) : (
          <>Ejecuta la Lambda de <strong>{typeMeta?.label}</strong> para ver los resultados aquí.</>
        )}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="fade-in" style={{ display: "grid", gap: 16 }}>
      <div className="skeleton" style={{ height: 48, width: "40%" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {[1,2,3,4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 80 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}

const styles = {
  shell: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    background: "var(--bg)",
  },
  main: {
    flex: 1,
    width: "100%",
    margin: "0 auto",
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text)",
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "var(--muted)",
    marginTop: 2,
  },
  errorBox: {
    background: "var(--red-soft)",
    border: "1px solid #fecaca",
    borderRadius: "var(--radius)",
    padding: "12px 16px",
    color: "#b91c1c",
    fontSize: 13,
    marginBottom: 16,
  },
  emptyState: {
    background: "var(--surface)",
    border: "1px dashed var(--border-strong)",
    borderRadius: "var(--radius)",
    padding: "60px 24px",
    textAlign: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: "var(--text)",
    marginBottom: 6,
  },
  emptyText: {
    color: "var(--muted)",
    fontSize: 14,
  },
};
