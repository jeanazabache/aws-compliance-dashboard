# Plan de implementación — Auditoría de Fluent Bit en servicios ECS

Tareas para implementar el Lambda `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit` y su
vista en el dashboard.

- [x] 1. Crear el backend del Lambda (`lambda/audit_ecs_fluentbit/`)
  - [x] 1.1 Crear `audit_core.py` con el modelo `ServiceAudit`, el escaneo ECS multi-región (`ListClusters` → `ListServices` → `DescribeServices` en lotes de 10 → `DescribeTaskDefinition` con cache por ARN), la detección exacta de `agent-fluentbit`, `run_audit()` con `ThreadPoolExecutor` y ordenamiento (Non-compliant → Skipped → Compliant), y `build_report()` con el schema definido (summary de 4 claves + `clusters[]` agregado).
    - _Requisitos: 1, 2, 3, 4_
  - [x] 1.2 Crear `handler.py` clonando el patrón de `audit_cloudwatch_logs/handler.py`, ajustando el prefijo S3 a `reports/audit_ecs_fluentbit/<account_id>/` y el log final con los counts de servicios.
    - _Requisitos: 4_
  - [x] 1.3 Crear `inline-policy.json` (permisos ECS read + S3 write), `trust-policy.json`, `env.json` (con `FLUENTBIT_CONTAINER_NAME`, `SCAN_MAX_WORKERS`, `REPORTS_BUCKET`) y `requirements.txt` vacío.
    - _Requisitos: 2, 5_
  - [x] 1.4 Validar la sintaxis Python de ambos archivos (`python -m py_compile`).
    - _Requisitos: 1, 2, 3, 4_

- [x] 2. Crear la vista del dashboard
  - [x] 2.1 Crear `dashboard/src/components/EcsFluentbitReportDetail.jsx` reutilizando la estructura de `CloudwatchLogsReportDetail.jsx`: header con pills, summary cards clickeables como filtros, panel de cumplimiento por cluster (click-to-filter), toolbar (page-size + búsqueda), tabla paginada de servicios resaltando `agent-fluentbit` en la lista de contenedores.
    - _Requisitos: 6_
  - [x] 2.2 Registrar `audit_ecs_fluentbit` en el mapa `VIEW_BY_SCRIPT` de `ReportDetail.jsx`.
    - _Requisitos: 6_
  - [x] 2.3 Agregar la entrada del tab en `AUDIT_TYPES` de `App.jsx` (icon 🚢, accent cyan, label "Fluent Bit en ECS").
    - _Requisitos: 6_
  - [x] 2.4 Verificar que `ACCOUNT_ALIASES` esté presente en el nuevo componente (DEV/QA/PRD) consistente con los otros.
    - _Requisitos: 6_

- [x] 3. Actualizar infraestructura compartida
  - [x] 3.1 Añadir el prefijo `reports/audit_ecs_fluentbit/*` al statement `AllowCrossAccountAuditWrites` de `infra/bucket-policy-cross-account.json`.
    - _Requisitos: 5_

- [x] 4. Build y validación local del dashboard
  - [x] 4.1 Ejecutar `npm run build` y confirmar que compila sin errores (115 módulos, OK).
    - _Requisitos: 6_

- [x] 5. Despliegue en DEV (792654060327)
  - [x] 5.1 Aplicar la bucket policy actualizada desde DEV (`put-bucket-policy`).
    - _Requisitos: 5_
  - [x] 5.2 Crear rol IAM `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit-Role` + attach `AWSLambdaBasicExecutionRole` + inline policy.
    - _Requisitos: 5_
  - [x] 5.3 Empaquetar y crear la función Lambda (Python 3.12, timeout 600s, 512 MB, env vars).
    - _Requisitos: 5_
  - [x] 5.4 Invocar para validar: status 200, summary coherente (192/105/87/0). Confirmado `UTP-A190-ECS-DEV-00-App / 02-configurationServices` = Compliant con `agent-fluentbit`.
    - _Requisitos: 2, 3, 4_
  - [x] 5.5 Crear regla EventBridge `cron(0 0/4 * * ? *)` + permiso + target.
    - _Requisitos: 5_
  - [x] 5.6 Build + deploy del dashboard a S3 + invalidación CloudFront.
    - _Requisitos: 6_

- [x] 6. Despliegue en QA (213698163176)
  - [x] 6.1 Crear rol + lambda + EventBridge `cron(3 0/4 * * ? *)` e invocar para validar (200, 165/101/64/0).
    - _Requisitos: 5_

- [x] 7. Despliegue en PRD (503134114226)
  - [x] 7.1 Crear rol + lambda + EventBridge `cron(6 0/4 * * ? *)` e invocar para validar (200, 131/82/49/0).
    - _Requisitos: 5_

- [x] 8. Documentación
  - [x] 8.1 Actualizar `SETUP.md`: agregar el Lambda 04 a la tabla de auditorías, números reservados, estructura del proyecto, tabla de programación EventBridge, y una sección de despliegue del audit 04.
    - _Requisitos: 5_
