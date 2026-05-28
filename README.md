<div align="center">

# AGN Audit Platform

**Plataforma serverless multi-cuenta para auditorías programadas en AWS, con dashboard web propio.**

[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?logo=awslambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![CloudFront](https://img.shields.io/badge/AWS-CloudFront-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com/cloudfront/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ¿Qué es esto?

Una plataforma que ejecuta **auditorías diarias automáticas** sobre múltiples cuentas AWS de UTP, almacena los reportes en un bucket S3 central y los expone en un **dashboard web interactivo** servido por CloudFront.

Hoy detecta:

- 🐙 **Repositorios GitHub** sin la configuración estándar (rama `master`, environment `prd`, required reviewer del equipo).
- 🏷️ **Recursos AWS sin el tag obligatorio** `t.aplicacion` (necesario para tracking de costos por aplicación).
- 📊 **CloudWatch Log Groups con mayor ingesta** y costo estimado, además de log groups sin retention configurada.

Diseñado para crecer: agregar una auditoría nueva es una carpeta más en `lambda/` y un componente más en `dashboard/`.

---

## ✨ Características principales

- 🔍 **Auditorías programadas** con AWS Lambda + EventBridge, sin servidores que mantener.
- 🌐 **Multi-cuenta** con un solo bucket S3 central. Despliegas el mismo Lambda en cada cuenta y los reportes se consolidan automáticamente.
- 📈 **Dashboard web ligero** (~55 KB gzip) con tabs por tipo de auditoría, timeline horizontal del histórico, filtros por cuenta y fecha.
- 🎨 **Tema claro corporativo** con identidad visual UTP. Responsive desktop / tablet / móvil.
- 🔧 **Cards interactivas como filtros**, búsqueda en tiempo real, scroll horizontal en tablas largas.
- 🚀 **Cero dependencias propias** del runtime Lambda (excepto `requests` para GitHub). Todo lo demás usa boto3 que ya viene con AWS.
- 💰 **Estimación de costos** integrada (CloudWatch Logs muestra costo USD por log group).

---

## 🖼️ Vista previa

```
┌─────────────────────────────────────────────────────────────┐
│ 🎓 UTP    │  AWS Operaciones & DevOps         │  ↺ Actualizar│
│           │  Auditorías programadas           │              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 🐙 Repos     │  │ 🏷️ Tags AWS  │  │ 📊 Logs       │      │
│  │ GitHub       │  │              │  │              │      │
│  │ 16% ━━━░░░░  │  │ 95% ━━━━━━━  │  │ 261GB · $131│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  Filtros: [DEV] [QA] [PRD]  📅 [27 may 2026]                │
│  ◀ ─chip─ ─chip─ ─chip─ ─chip─ ─chip─ ▶                    │
│                                                              │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐                   │
│  │  624  │ │  102  │ │  521  │ │   1   │                   │
│  │ Total │ │   ✓   │ │ Acción│ │ Skip  │                   │
│  └───────┘ └───────┘ └───────┘ └───────┘                   │
│                                                              │
│  Tabla detallada con búsqueda y ordenamiento...             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Arquitectura

```
EventBridge (cron diario)
       │
       ├──► Lambda: Repos GitHub      ──► Secrets Manager → GitHub API
       │
       ├──► Lambda: Tags AWS          ──► Resource Groups Tagging API
       │       (DEV / QA / PRD)            (multi-region paralelo)
       │
       └──► Lambda: CloudWatch Logs   ──► CloudWatch + Logs APIs
               (DEV / QA / PRD)            (multi-region paralelo)
                            │
                            ▼
              S3 Bucket central (cuenta DEV)
              ├── reports/index.json          ← manifest
              ├── reports/<audit>/<account>/<timestamp>.json
              └── index.html + assets         ← dashboard React
                            │
                            ▼
                     CloudFront → Usuarios
```

**Modelo cross-account:** los Lambdas viven en cada cuenta auditada, pero todos escriben al mismo bucket gracias a una bucket policy que autoriza explícitamente cada `account_id`. Los reportes quedan particionados por cuenta para no colisionar.

---

## 📂 Estructura

```
agn-audit-platform/
├── infra/
│   └── bucket-policy-cross-account.json    # Bucket policy compartida
├── lambda/
│   ├── audit_utp_repos/                    # Audit 01 — Repos GitHub
│   ├── audit_aws_tags/                     # Audit 02 — Tags t.aplicacion
│   └── audit_cloudwatch_logs/              # Audit 03 — Top log groups
├── dashboard/
│   ├── public/utp-logo.svg
│   └── src/
│       ├── App.jsx                         # Shell + tabs + state
│       ├── components/
│       │   ├── AuditTypeTabs.jsx
│       │   ├── ReportTimeline.jsx
│       │   ├── TimelineFilters.jsx
│       │   ├── ReportDetail.jsx            # Despachador VIEW_BY_SCRIPT
│       │   ├── UtpReposReportDetail.jsx
│       │   ├── AwsTagsReportDetail.jsx
│       │   ├── CloudwatchLogsReportDetail.jsx
│       │   └── StatusBadge.jsx
│       └── index.css                       # Variables CSS + responsive
├── README.md                               # Este archivo
└── SETUP.md                                # Guía técnica completa
```

---

## 🚀 Quick start

> Para una guía detallada paso a paso ver [`SETUP.md`](./SETUP.md).

### Requisitos

- Cuenta AWS con permisos de admin en al menos una cuenta destino.
- AWS CLI v2 configurado con SSO o credenciales.
- Python 3.12 (solo si vas a empaquetar Lambdas localmente).
- Node.js 18+ y npm (solo para el dashboard).

### Desplegar un Lambda nuevo

```powershell
# 1. Verificar que estás en la cuenta correcta
aws sts get-caller-identity --query Account --output text

# 2. Empaquetar
cd lambda/audit_aws_tags
Compress-Archive -Path handler.py, audit_core.py `
  -DestinationPath lambda.zip -Force

# 3. Crear rol IAM, función Lambda y EventBridge rule
# (ver comandos completos en SETUP.md)
```

### Build & deploy del dashboard

```powershell
cd dashboard
npm install
npm run build
aws s3 sync dist/ s3://<tu-bucket>/ --exclude "reports/*" --delete
aws cloudfront create-invalidation --distribution-id <dist-id> --paths "/*"
```

---

## 🛠️ Stack técnico

| Componente   | Tecnología                                     |
|--------------|------------------------------------------------|
| Compute      | AWS Lambda (Python 3.12, x86_64)               |
| Scheduling   | Amazon EventBridge (cron rules)                |
| Storage      | Amazon S3 (bucket central cross-account)       |
| CDN          | Amazon CloudFront (con OAC)                    |
| Frontend     | React 18 + Vite 5 (sin TypeScript, sin librería UI) |
| Auth secrets | AWS Secrets Manager (token GitHub)             |
| IAM          | Roles dedicados por Lambda + bucket policies   |
| Observabilidad | CloudWatch Logs (logs de Lambda + audit object) |

**Bundle del frontend:** ~55 KB gzip, build en <1 segundo, sin TypeScript ni librerías externas de UI.

---

## 📋 Auditorías incluidas

### 🐙 Audit 01 — Repos GitHub `UTP-AOPE-LA-01-Reporte-de-Auditoria`

Verifica que cada repo de la organización GitHub `UTPXpedition` cumpla:

- ✅ Tiene rama `master`.
- ✅ Tiene environment `prd`.
- ✅ El environment `prd` tiene como required reviewer al team `team-operaciones`.

Soporta modo `apply` para remediación automática (con doble guardrail por env vars).

### 🏷️ Audit 02 — Tags AWS `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`

Audita todos los recursos taggable de la cuenta usando `resourcegroupstaggingapi:GetResources`. Detecta cuáles tienen el tag obligatorio `t.aplicacion` (necesario para tracking de costos por aplicación). Multi-región en paralelo con `ThreadPoolExecutor`.

### 📊 Audit 03 — CloudWatch Logs `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`

Para cada log group mide:

- Bytes y eventos ingresados en los últimos N días (default 7) vía `cloudwatch:GetMetricData`.
- Storage actual y retention configurada.
- **Costo estimado USD** = `(bytes / 1 GiB) × $0.50`.
- Marca `Non-compliant` si retention es null (nunca expira = costo permanente).

Identifica los principales generadores de costo (típicamente PRD).

---

## 🗺️ Roadmap

Ideas en pipeline para futuras versiones:

- [ ] **Autenticación con IAM Identity Center** federado, vía Cognito + Lambda@Edge.
- [ ] **Exportar a CSV** desde cualquier tabla.
- [ ] **Deep links** con estado en URL (`?tab=tags&account=...&date=...`).
- [ ] **Alertas Slack/Email** si la cobertura cae >5% día a día.
- [ ] **Diff entre reportes** consecutivos (qué cambió respecto a ayer).
- [ ] **Modo oscuro** opcional.
- [ ] **Lambda 04** para aplicar retention masiva a logs sin política.
- [ ] **Compresión gzip** de los reportes JSON en S3 (10x más livianos).

---

## 🤝 Contribuir

¿Quieres agregar una auditoría nueva? El patrón es:

1. Reservar el siguiente número de la nomenclatura (`UTP-AOPE-LA-<NN>`).
2. Crear `lambda/<carpeta>/` con `handler.py`, `audit_core.py`, `inline-policy.json`, `trust-policy.json`, `env.json`, `requirements.txt`.
3. Asegurarse de que `build_report()` retorne el [contrato JSON estándar](./SETUP.md#contrato-de-reportes-json-importante).
4. Crear `dashboard/src/components/<Nombre>ReportDetail.jsx`.
5. Registrarlo en `ReportDetail.jsx` (mapa `VIEW_BY_SCRIPT`) y `App.jsx` (lista `AUDIT_TYPES`).
6. Rebuild + deploy del dashboard.

Detalle completo en [`SETUP.md`](./SETUP.md#cómo-agregar-una-nueva-auditoría-al-dashboard).

---

## 📄 Licencia

MIT © Jean Azabache Medina

---

<div align="center">

**By Jean Azabache Medina** · UTP — Operaciones & DevOps

</div>
