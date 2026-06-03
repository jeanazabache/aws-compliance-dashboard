# =============================================================================
# setup-cognito.ps1  ·  UTP-AOPE Dashboard
# -----------------------------------------------------------------------------
# Crea el Cognito User Pool + App Client que protege el login del dashboard,
# y registra el primer usuario del equipo.
#
# Cuenta destino: DEV (792654060327)   ·   Región: us-east-1
#
# Este script es de UNA SOLA EJECUCIÓN (one-time setup). Si lo corres de nuevo
# creará un pool duplicado. Para agregar más usuarios luego usa solo el bloque
# `admin-create-user` del final.
#
# Uso:
#   ./infra/setup-cognito.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

$region   = "us-east-1"
$poolName = "UTP-AOPE-Dashboard-Users"

# --- Salvaguarda de cuenta: aborta si no estás en DEV ------------------------
$acc = (aws sts get-caller-identity --query Account --output text)
if ($acc -ne "792654060327") {
    throw "No estas en la cuenta DEV (estas en $acc). Cambia de sesion SSO antes de continuar."
}
Write-Host "OK - cuenta DEV confirmada ($acc), region $region" -ForegroundColor Green

# --- 1. User Pool ------------------------------------------------------------
# alias-attributes email  -> el username es libre ("jazabache") y ademas se
#                            puede iniciar sesion con el correo.
# auto-verified email      -> Cognito envia el correo de invitacion/temp pass.
$poolId = (aws cognito-idp create-user-pool `
    --pool-name $poolName `
    --alias-attributes email `
    --auto-verified-attributes email `
    --region $region `
    --query "UserPool.Id" --output text)
Write-Host "User Pool creado: $poolId" -ForegroundColor Green

# --- 2. App Client (SPA, sin client secret) ----------------------------------
$clientId = (aws cognito-idp create-user-pool-client `
    --user-pool-id $poolId `
    --client-name "dashboard-web" `
    --no-generate-secret `
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH `
    --region $region `
    --query "UserPoolClient.ClientId" --output text)
Write-Host "App Client creado: $clientId" -ForegroundColor Green

# --- 3. Primer usuario -------------------------------------------------------
# username "jazabache", email jazabache@utp.edu.pe (verificado para el alias).
# Cognito envia por correo el username + contrasena temporal; en el primer
# login el dashboard pedira definir la contrasena definitiva.
aws cognito-idp admin-create-user `
    --user-pool-id $poolId `
    --username "jazabache" `
    --user-attributes Name=email,Value="jazabache@utp.edu.pe" Name=email_verified,Value=true `
    --region $region | Out-Null
Write-Host "Usuario 'jazabache' creado (invitacion enviada a jazabache@utp.edu.pe)" -ForegroundColor Green

# --- 4. Escribir dashboard/.env ----------------------------------------------
$envPath = Join-Path $PSScriptRoot "..\dashboard\.env"
@"
VITE_COGNITO_USER_POOL_ID=$poolId
VITE_COGNITO_CLIENT_ID=$clientId
"@ | Set-Content -Path $envPath -Encoding UTF8
Write-Host "Escrito $envPath" -ForegroundColor Green

Write-Host ""
Write-Host "=== LISTO ===" -ForegroundColor Cyan
Write-Host "VITE_COGNITO_USER_POOL_ID=$poolId"
Write-Host "VITE_COGNITO_CLIENT_ID=$clientId"
Write-Host ""
Write-Host "Siguiente paso: cd dashboard; npm run build; deploy a S3 + invalidar CloudFront."
