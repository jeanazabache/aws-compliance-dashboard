# Contexto de Despliegue — AGN Audit Platform

Archivo de contexto para darle a cualquier agente/chat nuevo.
Contiene todo lo necesario para operar sin depender de historial previo.

---

## 🔐 AWS SSO — Perfiles configurados

**Portal SSO:** `https://utp.awsapps.com/start/`
**Archivo de config:** `~/.aws/config`

```ini
[default]
region = us-east-1
output = json

[profile dev]
sso_start_url = https://utp.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 792654060327
sso_role_name = AdministratorAccess
region = us-east-1
output = json

[profile qa]
sso_start_url = https://utp.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 213698163176
sso_role_name = AdministratorAccess
region = us-east-1
output = json

[profile prd]
sso_start_url = https://utp.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 503134114226
sso_role_name = AdministratorAccess
region = us-east-1
output = json
```

### Login único (habilita las 3 cuentas):

```powershell
aws sso login --profile dev
```

Esto abre el navegador una sola vez. Como las 3 cuentas comparten el mismo `sso_start_url`, el token sirve para las 3.

### Verificar acceso a las 3 cuentas:

```powershell
aws sts get-caller-identity --profile dev --query Account --output text   # → 792654060327
aws sts get-caller-identity --profile qa  --query Account --output text   # → 213698163176
aws sts get-caller-identity --profile prd --query Account --output text   # → 503134114226
```

### Uso con cualquier comando:

```powershell
aws lambda list-functions --profile qa
aws s3 ls s3://utp-aope-reportes-de-auditoria/ --profile dev
aws ecs list-clusters --profile prd
```

---

## 📋 Cuentas AWS

| Alias | Account ID     | Perfil CLI | Propósito                                    |
|-------|----------------|------------|----------------------------------------------|
| DEV   | 792654060327   | `dev`      | Bucket S3 central + CloudFront + dashboard + Cognito |
| QA    | 213698163176   | `qa`       | Cuenta auditada                              |
| PRD   | 503134114226   | `prd`      | Cuenta auditada                              |

**Región principal:** `us-east-1`
**Identity Center:** cuenta master `551233047885`

---

## 🚀 Flujo de despliegue de una Lambda nueva (LA-XX)

### Paso 0: Confirmar sesión activa

```powershell
aws sso login --profile dev   # Solo si la sesión expiró
```

### Paso 1: Crear archivos en `lambda/<nombre_lambda>/`

- `handler.py` — entry point
- `audit_core.py` — lógica de auditoría
- `env.json` — `{"Variables": {"REPORTS_BUCKET": "utp-aope-reportes-de-auditoria"}}`
- `inline-policy.json` — permisos específicos + s3:PutObject/GetObject
- `trust-policy.json` — trust para lambda.amazonaws.com
- `requirements.txt`

### Paso 2: Desplegar en cada cuenta (repetir para dev, qa, prd)

```powershell
$profile = "dev"  # Cambiar a "qa" o "prd" para cada cuenta
$lambdaName = "UTP-AOPE-LA-XX-Nombre-Descriptivo"
$roleName = "$lambdaName-Role"
$basePath = "<ruta al proyecto>\lambda\<carpeta_lambda>"

# 2.1 Crear rol IAM
aws iam create-role `
  --role-name $roleName `
  --assume-role-policy-document "file://$basePath\trust-policy.json" `
  --description "Rol para Lambda $lambdaName" `
  --profile $profile

# 2.2 Adjuntar política básica de logs
aws iam attach-role-policy `
  --role-name $roleName `
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" `
  --profile $profile

# 2.3 Adjuntar inline policy con permisos específicos
aws iam put-role-policy `
  --role-name $roleName `
  --policy-name "$lambdaName-Inline" `
  --policy-document "file://$basePath\inline-policy.json" `
  --profile $profile

# 2.4 Empaquetar
Compress-Archive -Path "$basePath\handler.py", "$basePath\audit_core.py" `
  -DestinationPath "$basePath\lambda.zip" -Force

# 2.5 Esperar propagación del rol (10s)
Start-Sleep -Seconds 10

# 2.6 Obtener account ID y ARN del rol
$accountId = aws sts get-caller-identity --profile $profile --query Account --output text
$roleArn = "arn:aws:iam::${accountId}:role/$roleName"

# 2.7 Crear función Lambda
aws lambda create-function `
  --function-name $lambdaName `
  --runtime python3.12 `
  --handler handler.lambda_handler `
  --role $roleArn `
  --zip-file "fileb://$basePath\lambda.zip" `
  --timeout 300 `
  --memory-size 256 `
  --environment "file://$basePath\env.json" `
  --architectures x86_64 `
  --description "Descripcion de la Lambda" `
  --profile $profile

# 2.8 Crear regla EventBridge (cron diario 09:00 UTC)
$ruleName = "$lambdaName-Schedule"
$lambdaArn = "arn:aws:lambda:us-east-1:${accountId}:function:$lambdaName"

aws events put-rule `
  --name $ruleName `
  --schedule-expression "cron(0 9 * * ? *)" `
  --state ENABLED `
  --description "Trigger diario para $lambdaName" `
  --profile $profile

# 2.9 Permiso para que EventBridge invoque la Lambda
aws lambda add-permission `
  --function-name $lambdaName `
  --statement-id "EventBridgeInvoke" `
  --action "lambda:InvokeFunction" `
  --principal "events.amazonaws.com" `
  --source-arn "arn:aws:events:us-east-1:${accountId}:rule/$ruleName" `
  --profile $profile

# 2.10 Asociar target
aws events put-targets `
  --rule $ruleName `
  --targets "Id=1,Arn=$lambdaArn" `
  --profile $profile
```

### Paso 3: Actualizar bucket policy (solo la primera vez para una Lambda nueva)

La bucket policy en DEV (`infra/bucket-policy-cross-account.json`) debe incluir el nuevo prefijo:

```json
"arn:aws:s3:::utp-aope-reportes-de-auditoria/reports/<nombre_script>/*"
```

Aplicar:

```powershell
aws s3api put-bucket-policy `
  --bucket utp-aope-reportes-de-auditoria `
  --policy "file://<ruta>/infra/bucket-policy-cross-account.json" `
  --profile dev
```

### Paso 4: Probar ejecución

```powershell
# Invocación asíncrona (no espera — la Lambda tarda ~60s escaneando regiones)
aws lambda invoke `
  --function-name $lambdaName `
  --payload '{}' `
  --invocation-type Event `
  --cli-binary-format raw-in-base64-out `
  --profile $profile `
  NUL

# Verificar que el reporte llegó a S3 (esperar ~70s)
aws s3 ls "s3://utp-aope-reportes-de-auditoria/reports/<script>/$accountId/" --recursive --profile dev
```

---

## 🌐 Flujo de actualización del Dashboard

### Registrar la nueva auditoría en el código:

1. **`dashboard/src/components/<Nombre>ReportDetail.jsx`** — componente visual nuevo.
2. **`dashboard/src/components/ReportDetail.jsx`** — agregar import + entrada en `VIEW_BY_SCRIPT`.
3. **`dashboard/src/App.jsx`** — agregar entrada en el array `AUDIT_TYPES`.

### Compilar y desplegar:

```powershell
cd dashboard

# Build
npm run build

# Sync a S3 (NUNCA borrar /reports/*)
aws s3 sync dist/ s3://utp-aope-reportes-de-auditoria/ --exclude "reports/*" --delete --profile dev

# Invalidar CloudFront
aws cloudfront create-invalidation `
  --distribution-id EG6X3GGBAMYXT `
  --paths "/index.html" "/assets/*" `
  --profile dev
```

Esperar 1-2 min y abrir https://operaciones.utpxpedition.com/ con Ctrl+F5.

---

## 📐 Nomenclatura obligatoria

| Recurso          | Patrón                             | Ejemplo                                         |
|------------------|------------------------------------|-------------------------------------------------|
| Lambda function  | `UTP-AOPE-LA-<NN>-<Descripción>`   | `UTP-AOPE-LA-05-Reporte-de-ApiGateway-WAF`      |
| IAM Role         | `<lambda-name>-Role`               | `UTP-AOPE-LA-05-Reporte-de-ApiGateway-WAF-Role` |
| Inline policy    | `<lambda-name>-Inline`             | `UTP-AOPE-LA-05-Reporte-de-ApiGateway-WAF-Inline` |
| EventBridge rule | `<lambda-name>-Schedule`           | `UTP-AOPE-LA-05-Reporte-de-ApiGateway-WAF-Schedule` |

### Números reservados:

| NN | Lambda                                          | Script ID              |
|----|-------------------------------------------------|------------------------|
| 01 | `UTP-AOPE-LA-01-Reporte-de-Auditoria`          | `audit_utp_repos`      |
| 02 | `UTP-AOPE-LA-02-Reporte-de-Tag-Resource`       | `audit_aws_tags`       |
| 03 | `UTP-AOPE-LA-03-Reporte-de-CloudWatch-Logs`    | `audit_cloudwatch_logs`|
| 04 | `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit`     | `audit_ecs_fluentbit`  |
| 05 | `UTP-AOPE-LA-05-Reporte-de-ApiGateway-WAF`    | `audit_apigateway_waf` |

Siguiente disponible: **06**

---

## 📦 Infraestructura clave

| Recurso | Valor |
|---------|-------|
| S3 Bucket | `utp-aope-reportes-de-auditoria` (cuenta DEV) |
| CloudFront Distribution ID | `EG6X3GGBAMYXT` |
| Dominio | `https://operaciones.utpxpedition.com/` |
| Cognito User Pool ID | `us-east-1_iwtvN9dF2` |
| Cognito App Client ID | `5ih7hi44413pbs3aiv2gku4413` |

---

## 🔑 Contrato JSON de reportes

Cada Lambda debe retornar un JSON con esta estructura mínima:

```json
{
  "script": "audit_<nombre>",
  "timestamp": "2026-06-04T23:10:30Z",
  "account_id": "792654060327",
  "summary": {
    "total": 87,
    "compliant": 50,
    "needs_action": 37,
    "skipped": 0
  },
  "results": [...]
}
```

El `script` es el ID que conecta con el dashboard (usado en `VIEW_BY_SCRIPT` y `AUDIT_TYPES`).

---

## ⚠️ Notas importantes

- **SCP bloquea regiones:** La organización tiene una SCP que deniega acceso a regiones fuera de `us-east-1` (y algunas más). Los warnings de `AccessDeniedException` en regiones como `eu-west-1` son normales y el código los maneja con `try/except`.
- **Bucket policy:** Cada nueva Lambda necesita su prefijo en la bucket policy. Sin esto, QA y PRD no pueden escribir al bucket.
- **Invocación:** Usar siempre `--invocation-type Event` para testing porque las Lambdas tardan 60-120s escaneando todas las regiones (el CLI tiene timeout de 60s por defecto).
- **Dashboard:** El `--exclude "reports/*" --delete` es **CRÍTICO** en el sync — sin el exclude borrarías todos los reportes de auditoría.
- **Primer build:** En máquina nueva ejecutar `npm install` antes de `npm run build`.
