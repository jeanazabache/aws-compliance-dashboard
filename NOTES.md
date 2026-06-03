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
