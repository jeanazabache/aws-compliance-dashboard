# Diseño — Auditoría de Fluent Bit en servicios ECS

## Resumen

Lambda `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit` que recorre todos los clusters ECS
de la cuenta donde se ejecuta, inspecciona la task definition configurada de cada
servicio, y determina si incluye el contenedor sidecar `agent-fluentbit`. Produce un
reporte JSON con el contrato estándar del proyecto y lo escribe al bucket S3 central
con prefijo por `account_id`. Se despliega en DEV/QA/PRD con ejecución cada 4 horas y
se muestra en el dashboard como un tab nuevo.

El diseño reutiliza fielmente el patrón de `audit_cloudwatch_logs` (escaneo
multi-región en paralelo, `run_audit()` + `build_report()`, handler que escribe el
reporte y actualiza el manifest).

---

## Arquitectura

```
EventBridge (cron cada 4h, por cuenta)
        │
        ▼
  Lambda UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit
        │
        ├── sts:GetCallerIdentity            → account_id
        ├── ec2:DescribeRegions              → regiones habilitadas
        │
        └── por cada región (ThreadPoolExecutor):
              ├── ecs:ListClusters           → ARNs de clusters
              ├── ecs:ListServices           → ARNs de servicios por cluster
              ├── ecs:DescribeServices       → taskDefinition de cada servicio (batch de 10)
              └── ecs:DescribeTaskDefinition → containerDefinitions[].name
                                               (con cache por taskDefinition ARN)
        │
        ▼
   build_report() → JSON
        │
        ▼
   S3 reports/audit_ecs_fluentbit/<account_id>/<timestamp>.json
   S3 reports/index.json (insert al inicio)
        │
        ▼
   CloudFront → Dashboard (tab nuevo)
```

---

## Componentes y archivos

Nueva carpeta `lambda/audit_ecs_fluentbit/` replicando la estructura existente:

| Archivo               | Propósito                                                        |
|-----------------------|-----------------------------------------------------------------|
| `handler.py`          | Entry point. Idéntico patrón a `audit_cloudwatch_logs/handler.py` salvo el prefijo S3 y el log final. |
| `audit_core.py`       | Lógica de escaneo ECS + detección Fluent Bit + `build_report`.  |
| `inline-policy.json`  | Permisos IAM mínimos (ECS read + S3 write).                     |
| `trust-policy.json`   | Trust policy de Lambda (idéntica a las otras).                  |
| `env.json`            | Variables de entorno de referencia.                            |
| `requirements.txt`    | Vacío (boto3 viene en runtime).                                |

Frontend:

| Archivo                                          | Cambio                                       |
|--------------------------------------------------|----------------------------------------------|
| `dashboard/src/components/EcsFluentbitReportDetail.jsx` | NUEVO — vista de detalle.            |
| `dashboard/src/components/ReportDetail.jsx`      | Registrar `audit_ecs_fluentbit` en `VIEW_BY_SCRIPT`. |
| `dashboard/src/App.jsx`                          | Agregar entrada en `AUDIT_TYPES`.            |

Infra:

| Archivo                                  | Cambio                                                       |
|------------------------------------------|--------------------------------------------------------------|
| `infra/bucket-policy-cross-account.json` | Añadir `reports/audit_ecs_fluentbit/*` a los Resource.       |

---

## Detalle del backend (`audit_core.py`)

### Variables de entorno

```python
MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "8"))
FLUENTBIT_CONTAINER_NAME = os.environ.get("FLUENTBIT_CONTAINER_NAME", "agent-fluentbit")
```

### Modelo de datos

```python
@dataclass
class ServiceAudit:
    cluster: str            # nombre corto del cluster
    service: str            # nombre del servicio
    region: str
    task_definition: str    # "familia:revision"
    desired_count: int
    running_count: int
    launch_type: str        # FARGATE | EC2 | "" (si usa capacity provider)
    containers: list[str]   # nombres de todos los contenedores de la task def
    has_fluentbit: bool
    skipped_reason: str | None = None

    @property
    def status(self) -> str:
        if self.skipped_reason:
            return "Skipped"
        return "Compliant" if self.has_fluentbit else "Non-compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "cluster": self.cluster,
            "service": self.service,
            "region": self.region,
            "task_definition": self.task_definition,
            "desired_count": self.desired_count,
            "running_count": self.running_count,
            "launch_type": self.launch_type,
            "containers": self.containers,
            "has_fluentbit": self.has_fluentbit,
            "status": self.status,
            "detail": self.skipped_reason or "",
        }
```

### Flujo de escaneo por región (`_scan_region`)

1. `ecs:ListClusters` (paginado) → lista de cluster ARNs.
2. Por cada cluster:
   a. `ecs:ListServices` (paginado) → service ARNs.
   b. `ecs:DescribeServices` en lotes de **10** (límite de la API) → para cada
      servicio obtener `serviceName`, `taskDefinition`, `desiredCount`,
      `runningCount`, `launchType`.
   c. Por cada `taskDefinition` ARN: `ecs:DescribeTaskDefinition` (con **cache**
      en memoria por ARN, ya que varios servicios pueden compartir la misma def y
      no tiene sentido describirla dos veces) → extraer
      `containerDefinitions[].name`.
   d. `has_fluentbit = FLUENTBIT_CONTAINER_NAME in containers`.
3. Si un `DescribeTaskDefinition` falla → `ServiceAudit` con `skipped_reason`.

### Detección Fluent Bit

```python
def _evaluate(containers: list[str]) -> bool:
    return FLUENTBIT_CONTAINER_NAME in containers   # comparación exacta
```

El nombre del contenedor objetivo es exactamente `agent-fluentbit` (configurable).
No se usa substring para evitar falsos positivos.

### Paralelismo

Igual que `audit_cloudwatch_logs`: `ThreadPoolExecutor` con `MAX_WORKERS`, una tarea
por región. Como la ejecución es cada 4 horas, el tiempo no es crítico, pero el
paralelismo mantiene la corrida en pocos minutos aun con muchas regiones.

El cache de task definitions es **por región** (un dict local en `_scan_region`),
así se evita compartir estado entre hilos.

### Ordenamiento

`run_audit()` ordena los resultados poniendo primero los `Non-compliant`, luego
`Skipped`, luego `Compliant`; dentro de cada grupo por cluster y servicio. Así lo que
necesita atención aparece arriba en la tabla del dashboard.

---

## Schema del reporte JSON

```json
{
  "script": "audit_ecs_fluentbit",
  "timestamp": "2026-05-28T12:00:00Z",
  "account_id": "792654060327",
  "fluentbit_container_name": "agent-fluentbit",
  "summary": {
    "total": 42,
    "compliant": 35,
    "needs_action": 6,
    "skipped": 1,
    "clusters": 5
  },
  "clusters": [
    {
      "cluster": "UTP-A190-ECS-DEV-00-App",
      "region": "us-east-1",
      "services": 12,
      "compliant": 10,
      "non_compliant": 2,
      "skipped": 0
    }
  ],
  "results": [
    {
      "cluster": "UTP-A190-ECS-DEV-00-App",
      "service": "02-configurationServices",
      "region": "us-east-1",
      "task_definition": "utp-a190-configservices:7",
      "desired_count": 2,
      "running_count": 2,
      "launch_type": "FARGATE",
      "containers": ["ms-configurationServices", "datadog-agent", "agent-fluentbit"],
      "has_fluentbit": true,
      "status": "Compliant",
      "detail": ""
    }
  ]
}
```

`summary` mantiene las 4 claves estándar (`total`, `compliant`, `needs_action`,
`skipped`) para que el manifest y el cálculo agregado del dashboard funcionen sin
cambios. Se añade `clusters` (conteo) como extra.

`clusters` (array): agregado por cluster, análogo a `regions` en el audit 03 o
`services` en el audit 02. Sirve para la tabla resumen del dashboard.

---

## Permisos IAM (`inline-policy.json`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadECS",
      "Effect": "Allow",
      "Action": [
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ec2:DescribeRegions",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    },
    {
      "Sid": "WriteAuditReports",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::utp-aope-reportes-de-auditoria/*"
    }
  ]
}
```

Nota: las acciones de ECS de solo lectura (`List*`, `Describe*`) requieren
`Resource: "*"` porque no soportan permisos a nivel de recurso de forma fiable para
listados. Es el mínimo necesario; ninguna acción es mutante.

---

## Variables de entorno (`env.json`)

```json
{
  "Variables": {
    "REPORTS_BUCKET": "utp-aope-reportes-de-auditoria",
    "SCAN_MAX_WORKERS": "8",
    "FLUENTBIT_CONTAINER_NAME": "agent-fluentbit"
  }
}
```

---

## Despliegue

Mismo procedimiento de 6 pasos que el audit 02/03 (ver SETUP.md), por cada cuenta:

1. Verificar cuenta (`aws sts get-caller-identity`).
2. Crear rol `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit-Role` + attach managed
   `AWSLambdaBasicExecutionRole` + inline policy.
3. Empaquetar (`handler.py` + `audit_core.py`).
4. Crear función: Python 3.12, handler `handler.lambda_handler`, **timeout 600s**,
   memoria 512 MB, env vars de arriba.
5. Invocar para validar (status 200, summary con counts).
6. EventBridge: regla cada 4 horas con desfase por cuenta.

### Bucket policy

Antes de desplegar en QA/PRD, actualizar `infra/bucket-policy-cross-account.json`
añadiendo el prefijo `reports/audit_ecs_fluentbit/*` al statement
`AllowCrossAccountAuditWrites`, y aplicarla desde DEV.

### Programación EventBridge (cada 4 horas)

Cron cada 4 horas a partir de medianoche UTC, con desfase de minutos por cuenta para
no chocar al actualizar el manifest:

| Cuenta | Cron                          | Descripción                |
|--------|-------------------------------|----------------------------|
| DEV    | `cron(0 0/4 * * ? *)`         | 00:00, 04:00, 08:00...     |
| QA     | `cron(3 0/4 * * ? *)`         | 00:03, 04:03, 08:03...     |
| PRD    | `cron(6 0/4 * * ? *)`         | 00:06, 04:06, 08:06...     |

Regla: `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit-Schedule`.

---

## Dashboard — `EcsFluentbitReportDetail.jsx`

Reutiliza la estructura visual de `CloudwatchLogsReportDetail.jsx` (cards-filtro,
panel de agregado, tabla con búsqueda + paginación).

### Tab en `App.jsx`

```js
{
  id: "audit_ecs_fluentbit",
  label: "Fluent Bit en ECS",
  description: "Servicios ECS con sidecar de logging",
  icon: "🚢",
  accent: "#0891b2",   // cyan, distinto a los 3 existentes
}
```

### Estructura de la vista

1. **Header**: fecha, badge de cuenta (DEV/QA/PRD), pill con el nombre del contenedor
   buscado (`agent-fluentbit`).
2. **Summary cards (clickeables = filtros)**:
   - Total servicios (resetea filtro).
   - Con Fluent Bit (→ filtra `Compliant`), verde.
   - Sin Fluent Bit (→ filtra `Non-compliant`), rojo.
   - Skipped (→ filtra `Skipped`), gris.
   - Clusters (informativo).
   - % cobertura (informativo, color por umbral).
3. **Panel "Cumplimiento por cluster"**: tabla con cluster, región, nº servicios,
   compliant, non-compliant, barra de cobertura. Click en fila filtra por cluster.
4. **Toolbar**: page-size (10/25/50/100), filtro de región (select), búsqueda por
   cluster/servicio.
5. **Tabla de servicios** (paginada): cluster, servicio, región, task definition,
   contenedores (lista, resaltando `agent-fluentbit` si está), launch type, estado.
6. **Paginación** idéntica al componente de CloudWatch Logs.

### Cálculo del % en el tab (`App.jsx` / `AuditTypeTabs.jsx`)

`audit_ecs_fluentbit` usa el cálculo de compliance estándar
(`compliant / (total - skipped)`), igual que tags y repos. No necesita el caso
especial de bytes que tiene CloudWatch Logs. El código actual de `AuditTypeTabs`
ya soporta esto sin cambios (solo el `audit_cloudwatch_logs` tiene rama especial).

---

## Manejo de errores

| Escenario                                  | Comportamiento                                        |
|--------------------------------------------|-------------------------------------------------------|
| Región sin clusters ECS                    | Continúa, no agrega resultados de esa región.         |
| Cluster sin servicios                      | Se cuenta el cluster con 0 servicios en el agregado.  |
| `DescribeServices` falla para un lote      | Log warning, los servicios de ese lote se omiten.     |
| `DescribeTaskDefinition` falla             | Servicio marcado `Skipped` con `detail` del motivo.   |
| Throttling de ECS                          | boto3 retry adaptativo (10 intentos).                 |
| Región entera falla                        | Log warning, las demás regiones continúan.            |
| Servicio con `desiredCount=0`              | Se audita igual; `desired_count: 0` queda en el JSON. |

---

## Decisiones de diseño

1. **Auditar a nivel de servicio, no de task suelta.** El estándar de la organización
   se aplica a servicios ECS (lo que está corriendo de forma gestionada). Task
   definitions no asociadas a servicios quedan fuera del alcance (coincide con el
   ejemplo del usuario).
2. **Inspeccionar la task definition del servicio, no las tareas en ejecución.** Es
   más barato (no requiere `ListTasks`/`DescribeTasks`) y representa la configuración
   "deseada". Un servicio con `agent-fluentbit` en su task def cumple aunque
   momentáneamente no tenga tareas corriendo.
3. **Cache de task definitions por región.** Muchos servicios comparten la misma def;
   evita llamadas redundantes a `DescribeTaskDefinition`.
4. **Comparación exacta del nombre del contenedor.** Confirmado con el usuario: el
   sidecar siempre se llama `agent-fluentbit`. Configurable por env var.
5. **No se distingue Fargate vs EC2 para el cumplimiento**, pero se incluye
   `launch_type` en el reporte como información útil.

---

## Plan de pruebas

1. **Validación funcional (manual invoke)** en DEV: confirmar status 200 y que el
   summary tenga counts coherentes. Verificar que el servicio del ejemplo
   (`UTP-A190-ECS-DEV-00-App / 02-configurationServices`) aparezca como `Compliant`
   con `agent-fluentbit` en `containers`.
2. **Caso Non-compliant**: identificar un servicio sin el sidecar y confirmar que se
   marca correctamente.
3. **Cross-account**: invocar en QA y PRD, verificar escritura en el prefijo correcto
   del bucket (status 200 sin `FunctionError`).
4. **Dashboard**: confirmar que el tab nuevo carga, el % agregado suma las 3 cuentas,
   los filtros por card funcionan, y la búsqueda/paginación responden.
5. **Build del dashboard** sin errores antes de desplegar.
