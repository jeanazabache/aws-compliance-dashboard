# AGN Audit Platform — Setup & Context Guide

Plataforma serverless multi-cuenta para auditorías programadas en AWS con dashboard web.

**Stack:** AWS Lambda (Python 3.12) · S3 · CloudFront · React 18 + Vite · IAM · EventBridge.
**Dominio:** https://operaciones.utpxpedition.com/
**Repo:** uso interno del equipo de Operaciones & DevOps de UTP (UTPXpedition).

---

## TL;DR para un agente que llega nuevo

1. **3 Lambdas** (`audit_utp_repos`, `audit_aws_tags`, `audit_cloudwatch_logs`) corren cada día en EventBridge.
2. **3 cuentas AWS** auditadas: DEV (792654060327), QA (213698163176), PRD (503134114226).
3. **1 bucket S3 central** en DEV (`utp-aope-reportes-de-auditoria`) recibe reportes JSON de las 3 cuentas vía bucket policy cross-account.
4. **1 dashboard React** servido por CloudFront `EG6X3GGBAMYXT` desde el mismo bucket en DEV. Lee `reports/index.json` (manifest) y despacha vistas por `report.script`.
5. **Nomenclatura** corporativa estricta: `UTP-AOPE-LA-<NN>-<Descripción>` para Lambdas, `<lambda-name>-Role` para roles IAM.
6. Cuando despliegues, **siempre confirma cuenta antes**: `aws sts get-caller-identity --query Account --output text`.

---

## Cuentas y contexto AWS

| Alias | Account ID     | Propósito                                   | Acceso                           |
|-------|----------------|---------------------------------------------|----------------------------------|
| DEV   | 792654060327   | Hospeda S3 central + CloudFront + dashboard | SSO `utp.awsapps.com/start/`     |
| QA    | 213698163176   | Auditada (tags + logs)                      | SSO `utp.awsapps.com/start/`     |
| PRD   | 503134114226   | Auditada (tags + logs)                      | SSO `utp.awsapps.com/start/`     |

Identity Center vive en cuenta master `551233047885` (`utpmaster-aws`).
Los usuarios autorizados están en el grupo `SG-APP-AWS-USERS` (49 miembros), federado con Microsoft Entra ID + MFA.

**Región principal:** `us-east-1`. Los Lambdas de auditoría escanean todas las regiones habilitadas en paralelo.

---

## Convenciones de nomenclatura (UTP)

| Recurso          | Patrón                                | Ejemplo                                              |
|------------------|---------------------------------------|------------------------------------------------------|
| Lambda function  | `UTP-AOPE-LA-<NN>-<Description>`      | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`             |
| IAM Role         | `<lambda-name>-Role`                  | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource-Role`        |
| Inline policy    | `<lambda-name>-Inline`                | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource-Inline`      |
| EventBridge rule | `<lambda-name>-Schedule`              | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource-Schedule`    |
| S3 bucket        | `utp-aope-<descripcion>`              | `utp-aope-reportes-de-auditoria`                     |
| Secrets Manager  | `UTP-AOPE-SM-<NN>-<Description>`      | `UTP-AOPE-SM-00-AccesKey-GHE/Access`                 |

`<NN>` es un correlativo de dos dígitos por proyecto. **Reservados actualmente:**

| NN | Lambda                                          | Auditoría                                                    |
|----|-------------------------------------------------|--------------------------------------------------------------|
| 01 | `UTP-AOPE-LA-01-Reporte-de-Auditoria`           | Repos GitHub UTPXpedition (master + env prd + team approval) |
| 02 | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`        | Tag obligatorio `t.aplicacion` en recursos AWS               |
| 03 | `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`     | Top de log groups por ingesta + retention + costo            |

Para una Lambda nueva: usa el siguiente número disponible (`04`, `05`...).

---

## Arquitectura

```
EventBridge (cron diario por cuenta)
       │
       ├──► UTP-AOPE-LA-01 (DEV) ──► Secrets Manager → GitHub REST API (org UTPXpedition)
       │
       ├──► UTP-AOPE-LA-02 (DEV/QA/PRD) ──► Resource Groups Tagging API (multi-region paralelo)
       │
       └──► UTP-AOPE-LA-03 (DEV/QA/PRD) ──► CloudWatch Logs + GetMetricData (multi-region paralelo)
                            │
                            ▼
       S3 Bucket (utp-aope-reportes-de-auditoria, en cuenta DEV 792654060327)
       ├── reports/index.json                                      ← manifest común (más reciente arriba)
       ├── reports/audit_utp_repos/<timestamp>.json                ← single-account
       ├── reports/audit_aws_tags/<account_id>/<timestamp>.json    ← multi-account, prefijo por cuenta
       ├── reports/audit_cloudwatch_logs/<account_id>/<timestamp>.json
       ├── index.html                                              ← dashboard React build
       ├── assets/index-<hash>.js + .css
       └── utp-logo.svg
                            │
                            ▼
              CloudFront EG6X3GGBAMYXT
                            │
                            ▼
       https://operaciones.utpxpedition.com  (público, sin auth aún — pendiente)
```

**Modelo cross-account:** los Lambdas en QA y PRD asumen su rol local, pero el `s3:PutObject` apunta al bucket en DEV. La bucket policy en DEV autoriza explícitamente a los account IDs de QA y PRD vía `Principal: { "AWS": "arn:aws:iam::<id>:root" }`. Cada Lambda calcula su `account_id` con `sts:GetCallerIdentity` y lo usa como prefijo de la key, así no chocan entre cuentas.

---

## Estado actual de despliegue (snapshot 2026-05-27)

| Lambda                                          | DEV | QA  | PRD | Cron UTC               |
|-------------------------------------------------|-----|-----|-----|------------------------|
| `UTP-AOPE-LA-01-Reporte-de-Auditoria`           | ✅  | —   | —   | `cron(0 9 * * ? *)`    |
| `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`        | ✅  | ✅  | ✅  | DEV 30, QA 33, PRD 35  |
| `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`     | ✅  | ✅  | ✅  | DEV 40, QA 43, PRD 45  |

Detalles completos en la sección "Programación de EventBridge" más abajo.

**Cifras observadas en última corrida (referencia, no hardcoded):**
- Tags `t.aplicacion`: DEV 95.5%, QA 94.7%, PRD 89.3%.
- CloudWatch ingesta 7 días: DEV 8.4 GB / $4, QA 2.1 GB / $1, PRD 261 GB / $131 (~$565/mes).

---

## Estructura del proyecto

```
agn-audit-platform/
├── SETUP.md                              ← este archivo
├── infra/
│   └── bucket-policy-cross-account.json  ← policy compartida del bucket en DEV
├── lambda/
│   ├── audit_utp_repos/                  ← Lambda 01
│   │   ├── handler.py
│   │   ├── audit_core.py
│   │   ├── requirements.txt              ← requests + rich
│   │   ├── env.json
│   │   └── inline-policy.json
│   ├── audit_aws_tags/                   ← Lambda 02
│   │   ├── handler.py
│   │   ├── audit_core.py
│   │   ├── requirements.txt              ← (vacío, boto3 viene en runtime)
│   │   ├── env.json
│   │   ├── inline-policy.json
│   │   └── trust-policy.json
│   └── audit_cloudwatch_logs/            ← Lambda 03
│       ├── handler.py
│       ├── audit_core.py
│       ├── requirements.txt              ← (vacío, boto3 viene en runtime)
│       ├── env.json
│       ├── inline-policy.json
│       └── trust-policy.json
└── dashboard/
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── vite.config.js                    ← base: "./" para CloudFront
    ├── public/
    │   └── utp-logo.svg                  ← logo oficial UTP, dominio público
    └── src/
        ├── App.jsx                       ← shell + tabs + state global
        ├── main.jsx
        ├── index.css                     ← variables CSS, responsive, animaciones
        └── components/
            ├── AuditTypeTabs.jsx         ← tabs grandes por tipo de auditoría
            ├── ReportTimeline.jsx        ← chips horizontales del histórico
            ├── TimelineFilters.jsx       ← filtro de cuenta + fecha
            ├── ReportDetail.jsx          ← despachador: VIEW_BY_SCRIPT
            ├── UtpReposReportDetail.jsx  ← vista del audit 01
            ├── AwsTagsReportDetail.jsx   ← vista del audit 02
            ├── CloudwatchLogsReportDetail.jsx ← vista del audit 03
            └── StatusBadge.jsx
```

---

## Contrato de reportes JSON (importante)

Cualquier Lambda nuevo **debe** producir un JSON con esta forma mínima para que el dashboard lo entienda:

```json
{
  "script": "<nombre_unico_del_audit>",
  "timestamp": "2026-05-27T20:35:59Z",
  "account_id": "<opcional, si es multi-cuenta>",
  "summary": {
    "total": 0,
    "compliant": 0,
    "needs_action": 0,
    "skipped": 0
  },
  "results": [ /* array libre, lo consume tu componente */ ]
}
```

El handler escribe **dos** objetos en S3 en cada corrida:

1. El reporte completo en `reports/<script>/[<account_id>/]<timestamp>.json` con `:` reemplazados por `-` en el timestamp para que sea un key válido.
2. Una entrada nueva al inicio de `reports/index.json` con `script`, `timestamp`, `path`, `mode`, `account_id` (si aplica), `summary`. El dashboard ordena visualmente por `timestamp` desc.

**Patrón estándar del handler** (ver `audit_aws_tags/handler.py` o `audit_cloudwatch_logs/handler.py`):
1. Leer `REPORTS_BUCKET` de env.
2. Obtener `account_id` con `sts:GetCallerIdentity`.
3. Calcular `timestamp` ISO UTC.
4. Llamar `run_audit()` (lógica en `audit_core.py`).
5. Llamar `build_report()`.
6. Llamar `_save_to_s3()` (escribe el reporte + actualiza el manifest).

---

## Bucket S3 central (DEV)

El bucket `utp-aope-reportes-de-auditoria` ya existe en cuenta DEV.

**Bucket policy:** `infra/bucket-policy-cross-account.json`. Contiene 2 statements:

1. `AllowCloudFrontServicePrincipalReadOnly` — permite a la distribución `EG6X3GGBAMYXT` leer cualquier objeto. Condición: `AWS:SourceArn` debe ser ese ARN específico.
2. `AllowCrossAccountAuditWrites` — permite `s3:GetObject` y `s3:PutObject` desde los `:root` de DEV/QA/PRD, restringido a las keys `reports/audit_aws_tags/*`, `reports/audit_cloudwatch_logs/*` e `reports/index.json`.

**Block Public Access** está activo (`BlockPublicPolicy: true`). Por eso la policy NO usa `Principal: "*"` — el dashboard sirve por CloudFront, no por website hosting.

Aplicar la policy (solo desde DEV):

```powershell
aws s3api put-bucket-policy `
  --bucket utp-aope-reportes-de-auditoria `
  --policy file://infra/bucket-policy-cross-account.json
```

**Para agregar una nueva cuenta auditora:**
1. Editar `infra/bucket-policy-cross-account.json` añadiendo `arn:aws:iam::<NUEVA_CUENTA>:root` en `AllowCrossAccountAuditWrites`.
2. Cambiar a sesión de DEV y ejecutar el `put-bucket-policy` de arriba.
3. Editar `ACCOUNT_ALIASES` en `ReportTimeline.jsx`, `AwsTagsReportDetail.jsx`, `CloudwatchLogsReportDetail.jsx` agregando `"<id>": "<alias>"`.
4. Rebuild + deploy del dashboard (ver sección "Dashboard").

---

## Lambda 01 — Repos GitHub (`UTP-AOPE-LA-01-Reporte-de-Auditoria`)

**Solo se despliega en DEV.** No es multi-cuenta porque el GitHub PAT vive en Secrets Manager de DEV.

**Qué audita:** los repos de la organización GitHub `UTPXpedition`. Por cada repo verifica:
- Existe la rama `master`.
- Existe el environment `prd`.
- El environment `prd` tiene como required reviewer al team `team-operaciones`.

**Modos:**
- `AUDIT_MODE=audit` (default): solo reporta.
- `AUDIT_MODE=apply` + `APPLY_CONFIRM=true`: además remedia (crea `prd` y agrega reviewer del team). El reporte incluye `apply_actions[]`.

### Setup

1. **Token GitHub en Secrets Manager** (ya existe como `UTP-AOPE-SM-00-AccesKey-GHE/Access`).
   - Tipo: Other secret.
   - Clave `token`, valor: PAT con scopes `repo`, `admin:org`.
   - Si UTPXpedition exige SAML SSO, autorizar el token: GitHub → Settings → Developer settings → PAT → "Configure SSO → Authorize".

2. **Empaquetar:**
   ```powershell
   cd lambda\audit_utp_repos
   pip install -r requirements.txt -t package\
   copy handler.py package\
   copy audit_core.py package\
   Compress-Archive -Path package\* -DestinationPath lambda.zip -Force
   ```

3. **Crear función:**
   - Runtime Python 3.12, x86_64.
   - Handler: `handler.lambda_handler`.
   - Timeout: 5 min, memoria: 256 MB.
   - Env vars (`env.json`):
     - `GITHUB_SECRET_NAME` = nombre del secreto.
     - `REPORTS_BUCKET` = `utp-aope-reportes-de-auditoria`.
     - `AUDIT_MODE` = `audit`.
   - Inline policy: `audit_utp_repos/inline-policy.json` (permite `secretsmanager:GetSecretValue` del secreto + `s3:GetObject/PutObject` del bucket).

---

## Lambda 02 — Tags AWS (`UTP-AOPE-LA-02-Reporte-de-Tag-Resource`)

**Multi-cuenta.** Se despliega en DEV/QA/PRD. Cada uno escribe en `reports/audit_aws_tags/<account_id>/`.

**Qué audita:** todos los recursos taggable de la cuenta usando `resourcegroupstaggingapi:GetResources`. Detecta cuáles tienen el tag `t.aplicacion` con valor no vacío. Itera todas las regiones habilitadas en paralelo (`ThreadPoolExecutor`, default 8 workers, configurable).

**Env vars:**
- `REPORTS_BUCKET` = `utp-aope-reportes-de-auditoria`.
- `SCAN_MAX_WORKERS` (opcional, default 8).

**Permisos requeridos** (ver `inline-policy.json`):
- `tag:GetResources`, `tag:GetTagKeys`, `tag:GetTagValues`.
- `ec2:DescribeRegions`.
- `sts:GetCallerIdentity`.
- `s3:GetObject`, `s3:PutObject` sobre el bucket central.

### Despliegue por cuenta

```powershell
# 1. Verificar cuenta
aws sts get-caller-identity --query Account --output text

# 2. Crear rol IAM
$role = "UTP-AOPE-LA-02-Reporte-de-Tag-Resource-Role"
aws iam create-role --role-name $role `
  --assume-role-policy-document file://lambda/audit_aws_tags/trust-policy.json `
  --description "Lambda role for AWS tag audit"
aws iam attach-role-policy --role-name $role `
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name $role `
  --policy-name UTP-AOPE-LA-02-Reporte-de-Tag-Resource-Inline `
  --policy-document file://lambda/audit_aws_tags/inline-policy.json

# 3. Empaquetar
Compress-Archive `
  -Path lambda/audit_aws_tags/handler.py, lambda/audit_aws_tags/audit_core.py `
  -DestinationPath lambda/audit_aws_tags/lambda.zip -Force
Start-Sleep -Seconds 10  # esperar propagación del rol

# 4. Crear función (reemplaza <ACCOUNT_ID> con el actual)
$accountId = (aws sts get-caller-identity --query Account --output text)
aws lambda create-function `
  --function-name UTP-AOPE-LA-02-Reporte-de-Tag-Resource `
  --runtime python3.12 `
  --role "arn:aws:iam::${accountId}:role/$role" `
  --handler handler.lambda_handler `
  --zip-file fileb://lambda/audit_aws_tags/lambda.zip `
  --timeout 600 --memory-size 512 `
  --environment "Variables={REPORTS_BUCKET=utp-aope-reportes-de-auditoria,SCAN_MAX_WORKERS=8}" `
  --description "Audita el tag t.aplicacion en todos los recursos taggable de la cuenta"

# 5. Validar
aws lambda wait function-active --function-name UTP-AOPE-LA-02-Reporte-de-Tag-Resource
aws lambda invoke `
  --function-name UTP-AOPE-LA-02-Reporte-de-Tag-Resource `
  --cli-binary-format raw-in-base64-out --payload '{}' invoke-response.json
type invoke-response.json
# Esperado: {"statusCode": 200, "body": "{\"timestamp\":..., \"summary\":{...}}"}

# 6. EventBridge schedule (ver tabla de horarios abajo)
$rule = "UTP-AOPE-LA-02-Reporte-de-Tag-Resource-Schedule"
$lambdaArn = "arn:aws:lambda:us-east-1:${accountId}:function:UTP-AOPE-LA-02-Reporte-de-Tag-Resource"
aws events put-rule --name $rule --schedule-expression "cron(<MIN> 9 * * ? *)"
aws lambda add-permission --function-name UTP-AOPE-LA-02-Reporte-de-Tag-Resource `
  --statement-id AllowEventBridgeInvoke --action lambda:InvokeFunction `
  --principal events.amazonaws.com `
  --source-arn "arn:aws:events:us-east-1:${accountId}:rule/$rule"
aws events put-targets --rule $rule --targets "Id=1,Arn=$lambdaArn"
```

---

## Lambda 03 — CloudWatch Logs (`UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`)

**Multi-cuenta.** Mismo patrón que el 02, escribe en `reports/audit_cloudwatch_logs/<account_id>/`.

**Qué audita:** todos los CloudWatch log groups, midiendo:
- `IncomingBytes` y `IncomingLogEvents` agregados de los últimos `LOOKBACK_DAYS` (default 7) vía `cloudwatch:GetMetricData`.
- `storedBytes` y `retentionInDays` desde `logs:DescribeLogGroups`.
- Costo estimado USD = (bytes / 1 GiB) × `INGEST_COST_USD_PER_GB` (default $0.50).
- Marca `Non-compliant` si `retentionInDays` es `None` (nunca expira = caro).

**Env vars:**
- `REPORTS_BUCKET` = `utp-aope-reportes-de-auditoria`.
- `LOOKBACK_DAYS` (default `7`).
- `INGEST_COST_USD_PER_GB` (default `0.50`).
- `SCAN_MAX_WORKERS` (default `8`).

**Permisos requeridos** (`inline-policy.json`):
- `logs:DescribeLogGroups`.
- `cloudwatch:GetMetricData`.
- `ec2:DescribeRegions`, `sts:GetCallerIdentity`.
- `s3:GetObject`, `s3:PutObject` sobre el bucket central.

**Despliegue:** mismos 6 pasos que el Lambda 02, cambiando los nombres y el `--environment`. Empaquetado con `handler.py + audit_core.py` (sin deps extras).

---

## Programación de EventBridge

| Hora UTC  | Cuenta             | Lambda                                           | Cron                  |
|-----------|--------------------|--------------------------------------------------|-----------------------|
| 09:00     | DEV (792654060327) | `UTP-AOPE-LA-01-Reporte-de-Auditoria`            | `cron(0 9 * * ? *)`   |
| 09:30     | DEV (792654060327) | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`         | `cron(30 9 * * ? *)`  |
| 09:33     | QA  (213698163176) | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`         | `cron(33 9 * * ? *)`  |
| 09:35     | PRD (503134114226) | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`         | `cron(35 9 * * ? *)`  |
| 09:40     | DEV (792654060327) | `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`      | `cron(40 9 * * ? *)`  |
| 09:43     | QA  (213698163176) | `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`      | `cron(43 9 * * ? *)`  |
| 09:45     | PRD (503134114226) | `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`      | `cron(45 9 * * ? *)`  |

**Por qué separadas por minutos:** todas escriben al mismo `reports/index.json` (read-modify-write). 5 min entre escrituras evita race conditions sin necesidad de locking.

---

## Dashboard React

### Stack

- **React 18.3.1** + **Vite 5.4** (sin TypeScript, sin librería de UI; componentes y estilos custom).
- Sin enrutamiento (SPA single-view, las "tabs" son state local).
- Estilos: variables CSS en `:root` (tema claro), inline styles + clases CSS para responsive.
- Bundle final: ~55 KB gzip. ~40 módulos. Build local en <1 segundo.

### Modelo de datos en runtime

`App.jsx` carga `reports/index.json` (cache-busting con `?t=Date.now()`). Mantiene state:

- `index.reports[]` — lista completa, ordenada por timestamp desc.
- `activeType` — id del tipo activo (`audit_utp_repos | audit_aws_tags | audit_cloudwatch_logs`).
- `selectedPath` — path S3 del reporte mostrado.
- `accountFilter` (`"all" | "<account_id>"`) y `dateFilter` (`null | "YYYY-MM-DD"`).
- `report` — payload completo del reporte seleccionado.

`AUDIT_TYPES` en `App.jsx` define la lista de tabs (icon, label, accent color, descripción).

`VIEW_BY_SCRIPT` en `ReportDetail.jsx` mapea `report.script` → componente de detalle.

### Cómo agregar una nueva auditoría al dashboard

1. Crear `dashboard/src/components/<Nombre>ReportDetail.jsx` siguiendo el patrón de los existentes.
2. Registrarlo en `ReportDetail.jsx` dentro del mapa `VIEW_BY_SCRIPT`:
   ```js
   import NuevoReportDetail from "./NuevoReportDetail.jsx";
   const VIEW_BY_SCRIPT = {
     // ...
     audit_nuevo: NuevoReportDetail,
   };
   ```
3. Agregar el tab en `AUDIT_TYPES` de `App.jsx` con un nuevo `accent` y `icon`.
4. Si es multi-cuenta, agregar el alias en `ACCOUNT_ALIASES` de los componentes de detalle (DEV/QA/PRD están duplicados en 3 archivos por simplicidad).
5. Rebuild y deploy.

### Build & deploy

**Cuenta:** DEV (792654060327). Es donde vive el bucket y CloudFront.

```powershell
cd dashboard
npm install
npm run build                                          # genera dist/
aws s3 sync dist/ s3://utp-aope-reportes-de-auditoria/ `
  --exclude "reports/*" --delete                       # IMPORTANTE: --exclude reports/*

aws cloudfront create-invalidation `
  --distribution-id EG6X3GGBAMYXT `
  --paths "/index.html" "/assets/*"
```

**Crítico:** el bucket contiene tanto el sitio (`index.html`, `assets/`, `utp-logo.svg`) como los datos (`reports/`). El `--exclude "reports/*"` evita que `--delete` borre los reportes.

`vite.config.js` usa `base: "./"` para que los paths sean relativos (necesario porque CloudFront sirve con paths absolutos).

### Comportamiento de la UI

- **Topbar sticky** con logo UTP, título "AWS Operaciones & DevOps" y botón Actualizar. Responsive: en móvil ≤600px se oculta el subtítulo y el botón colapsa a icono.
- **Tabs grandes** (cards) muestran el % de cobertura y conteo del último reporte por tipo.
- **Timeline horizontal** con un chip por reporte histórico de la auditoría activa.
- **Filtros** sobre el timeline: cuenta (pastillas DEV/QA/PRD) + fecha (date input). Si un audit no tiene `account_id` en sus reportes (single-account), solo muestra fecha.
- **Summary cards = filtros**: las cifras grandes (Compliant, Sin tag, Sin retention) son botones que filtran la tabla. La activa queda con borde grueso + glow del color. Click otra vez deselecciona.
- **Tablas** con scroll horizontal en móvil (`overflow: auto` + `-webkit-overflow-scrolling: touch`).
- **Skeleton loaders** mientras carga (`shimmer` animation).
- **EmptyState** distingue "sin reportes todavía" vs "sin reportes con esos filtros" (con botón Limpiar).
- **Footer**: "By Jean Azabache Medina".

### Distribución CloudFront

- ID: `EG6X3GGBAMYXT` (en cuenta DEV 792654060327).
- Origen: `utp-aope-reportes-de-auditoria` con OAC (Origin Access Control).
- WebACL: el dashboard tuvo conflictos con el WAF gestionado por Firewall Manager (`FMManagedWebACLV2-UTP-FMS-POLICY-WEB-1777075321932`); actualmente desasociado. Si vuelves a asociar un WAF, asegurate de excluir `/reports/*` de las reglas SQL/XSS injection (los JSON pueden disparar falsos positivos).

---

## Pendientes / próximos pasos conocidos

1. **Autenticación.** Hoy la URL `https://operaciones.utpxpedition.com/` es pública. Plan acordado: integrar **Cognito User Pool federado con IAM Identity Center vía SAML** y proteger CloudFront con **Lambda@Edge** (blueprint `cloudfront-authorization-at-edge` de AWS Samples).
   - Identity Center está en cuenta master `551233047885`.
   - Usuarios autorizados: grupo `SG-APP-AWS-USERS`.
   - Callback URL: `https://operaciones.utpxpedition.com/_auth/callback`.
   - Wizard SAML en Identity Center fue iniciado pero pausado (necesita Cognito creado primero para llenar las URLs de ACS y audience).

2. **Limpieza de log groups sin retention.** El audit 03 detectó 310/149/160 log groups sin retention en DEV/QA/PRD. Considerar un Lambda 04 que aplique retention masiva (`logs:PutRetentionPolicy` con valor por defecto, ej. 30 días).

3. **`requirements.txt` de Lambda 01** todavía declara `rich`, pero el código usa solo `logging` estándar. Se puede quitar para reducir el tamaño del zip.

4. **Histórico del manifest.** `reports/index.json` solo crece (un entry por corrida diaria). A largo plazo (~1 año = ~2500 entries) puede ser pesado. Considerar paginación o compactación cuando supere los 500 entries.

---

## Convenciones para sub-agentes / contribuidores

- **Antes de cualquier comando AWS:** siempre `aws sts get-caller-identity --query Account --output text` y comparar con la cuenta esperada. Es muy fácil ejecutar comandos en la cuenta equivocada cuando se cambia entre DEV/QA/PRD.
- **No tocar recursos que no sean del proyecto.** La cuenta DEV tiene >150 Lambdas de otros proyectos (`UTP-A252-*`, `UTP-A200-*`, etc). Los nuestros solo son `UTP-AOPE-LA-0X-*` y `UTP-AOPE-LA-DEV-01-Opensearch-Delete-Logs`.
- **No hacer `git push` ni `git commit` sin que el usuario lo pida explícitamente.**
- **Preferir tools dedicados** (`fs_write`, `read_file`, `str_replace`) a comandos shell para crear/editar archivos.
- **Comandos shell:** Windows PowerShell (no cmd, no bash). Usar `;` como separador. Los path con espacios necesitan comillas dobles.
- **Limpiar artefactos** después de cada deploy: `dashboard/dist/`, `dashboard/node_modules/`, `lambda/*/lambda.zip`, `lambda/*/__pycache__/`, `invoke-response.json` no se commitean.
- **Identity Center / SSO:** la sesión SSO puede expirar. Si un comando falla con `ExpiredToken`, el usuario debe re-loguearse desde `https://utp.awsapps.com/start/`.

---

## Referencias rápidas

- Bucket reportes: `s3://utp-aope-reportes-de-auditoria/`
- CloudFront ID: `EG6X3GGBAMYXT`
- URL pública: `https://operaciones.utpxpedition.com/`
- Manifest: `https://operaciones.utpxpedition.com/reports/index.json`
- Org GitHub: `UTPXpedition`
- Team GitHub: `team-operaciones`
- Environment a auditar (audit 01): `prd`
- Tag obligatorio (audit 02): `t.aplicacion`
- Identity Center management instance: `utpmaster-aws` (551233047885)
