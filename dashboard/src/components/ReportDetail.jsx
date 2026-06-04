import UtpReposReportDetail from "./UtpReposReportDetail.jsx";
import AwsTagsReportDetail from "./AwsTagsReportDetail.jsx";
import CloudwatchLogsReportDetail from "./CloudwatchLogsReportDetail.jsx";
import EcsFluentbitReportDetail from "./EcsFluentbitReportDetail.jsx";
import ApigatewayWafReportDetail from "./ApigatewayWafReportDetail.jsx";

/**
 * Selector de vista según el tipo de reporte.
 * Cada nuevo Lambda añade su `script` y un componente especializado.
 */
const VIEW_BY_SCRIPT = {
  audit_utp_repos: UtpReposReportDetail,
  audit_aws_tags: AwsTagsReportDetail,
  audit_cloudwatch_logs: CloudwatchLogsReportDetail,
  audit_ecs_fluentbit: EcsFluentbitReportDetail,
  audit_apigateway_waf: ApigatewayWafReportDetail,
};

export default function ReportDetail({ report }) {
  const View = VIEW_BY_SCRIPT[report?.script];

  if (!View) {
    return (
      <div style={{ color: "var(--muted)" }}>
        Tipo de reporte desconocido: <code>{report?.script ?? "—"}</code>
      </div>
    );
  }

  return <View report={report} />;
}
