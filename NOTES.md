# Apuntes — AGN Audit Platform

Notas rápidas de comandos de uso frecuente.

---

## Login del dashboard (Cognito)

**User Pool (cuenta DEV 792654060327, región us-east-1):**
- User Pool ID: `us-east-1_iwtvN9dF2`
- App Client ID: `5ih7hi44413pbs3aiv2gku4413`

### Agregar un nuevo usuario al login

```powershell
# Genera una contrasena temporal limpia y la muestra en pantalla
.\infra\add-user.ps1 -Username "jperez" -Email "jperez@utp.edu.pe"

# O especificando tu propia contrasena temporal
.\infra\add-user.ps1 -Username "jperez" -Email "jperez@utp.edu.pe" -TempPassword "MiTemporal.2026"
```

Entrega usuario + contraseña temporal por un canal seguro (Teams / en persona).
En su primer login el dashboard le pedirá definir su contraseña definitiva.

### Comando directo (sin el script)

```powershell
aws cognito-idp admin-create-user `
  --user-pool-id us-east-1_iwtvN9dF2 `
  --username "<usuario>" `
  --user-attributes Name=email,Value="<correo>" Name=email_verified,Value=true `
  --message-action SUPPRESS `
  --region us-east-1

aws cognito-idp admin-set-user-password `
  --user-pool-id us-east-1_iwtvN9dF2 `
  --username "<usuario>" `
  --password "<temporal-limpia>" `
  --no-permanent `
  --region us-east-1
```

---

## Desplegar cambios del dashboard a S3 + CloudFront

**Cuenta:** DEV (792654060327) — ahí viven el bucket y CloudFront.
**Todos los comandos se ejecutan desde la carpeta `dashboard/`** (ahí está el `package.json`).

```powershell
cd dashboard

# 1) Confirmar que estoy en la cuenta DEV (debe devolver 792654060327)
aws sts get-caller-identity --query Account --output text

# 2) Compilar los cambios de React a dist/
npm run build

# 3) Subir dist/ al bucket.
#    --exclude "reports/*" es CRITICO: evita que --delete borre los datos de auditoria.
aws s3 sync dist/ s3://utp-aope-reportes-de-auditoria/ --exclude "reports/*" --delete

# 4) Invalidar la cache de CloudFront para ver los cambios al instante
aws cloudfront create-invalidation `
  --distribution-id EG6X3GGBAMYXT `
  --paths "/index.html" "/assets/*"
```

Luego espera 1-2 min y abre https://operaciones.utpxpedition.com/ con Ctrl+F5.

**Notas:**
- Primera vez en una maquina nueva: corre `npm install` antes del `npm run build`.
- Si el paso 1 no devuelve la cuenta DEV, vuelve a iniciar sesion en AWS (SSO) antes de seguir.
- Si el `aws s3 sync` no lista ningun archivo, es que dist/ ya es identico a S3:
  asegurate de haber editado el codigo fuente Y corrido `npm run build` de nuevo.
