# =============================================================================
# add-user.ps1  ·  UTP-AOPE Dashboard
# -----------------------------------------------------------------------------
# Agrega un usuario al Cognito User Pool del dashboard con una contrasena
# temporal LIMPIA y conocida (evita el problema de transcribir mal la
# contrasena autogenerada que Cognito manda por correo).
#
# El usuario queda en estado FORCE_CHANGE_PASSWORD: en su primer login el
# dashboard le pedira definir su contrasena definitiva.
#
# Cuenta destino: DEV (792654060327)   ·   Región: us-east-1
#
# Uso:
#   ./infra/add-user.ps1 -Username "jperez" -Email "jperez@utp.edu.pe"
#   ./infra/add-user.ps1 -Username "jperez" -Email "jperez@utp.edu.pe" -TempPassword "MiTemporal.2026"
#
# Si no pasas -TempPassword, el script genera una temporal valida y la muestra
# en pantalla para que se la entregues a la persona por un canal seguro.
# =============================================================================

param(
    [Parameter(Mandatory = $true)] [string] $Username,
    [Parameter(Mandatory = $true)] [string] $Email,
    [string] $TempPassword
)

$ErrorActionPreference = "Stop"

$region = "us-east-1"
$poolId = "us-east-1_iwtvN9dF2"   # User Pool del dashboard (DEV)

# --- Salvaguarda de cuenta ---------------------------------------------------
$acc = (aws sts get-caller-identity --query Account --output text)
if ($acc -ne "792654060327") {
    throw "No estas en la cuenta DEV (estas en $acc). Cambia de sesion SSO antes de continuar."
}

# --- Contrasena temporal -----------------------------------------------------
# Si no se especifico, generamos una que cumple la politica por defecto de
# Cognito (>=8 chars, mayuscula, minuscula, numero y simbolo) evitando
# caracteres ambiguos (l, I, 1, O, 0).
if (-not $TempPassword) {
    $upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    $lower = "abcdefghijkmnpqrstuvwxyz"
    $digit = "23456789"
    $sym   = "!.#$%"
    $all   = ($upper + $lower + $digit + $sym).ToCharArray()
    $rng   = [System.Random]::new()
    $chars = @(
        $upper[$rng.Next($upper.Length)],
        $lower[$rng.Next($lower.Length)],
        $digit[$rng.Next($digit.Length)],
        $sym[$rng.Next($sym.Length)]
    )
    1..8 | ForEach-Object { $chars += $all[$rng.Next($all.Length)] }
    $TempPassword = -join ($chars | Sort-Object { $rng.Next() })
}

# --- 1. Crear el usuario sin enviar correo (SUPPRESS) ------------------------
# IMPORTANTE: cada par Name=...,Value=... va entre comillas como UN solo
# argumento. Sin las comillas, PowerShell parte el token por la coma y AWS
# recibe el email mal formado (-> "Invalid email address format").
aws cognito-idp admin-create-user `
    --user-pool-id $poolId `
    --username $Username `
    --user-attributes "Name=email,Value=$Email" "Name=email_verified,Value=true" `
    --message-action SUPPRESS `
    --region $region | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Fallo admin-create-user (el usuario NO se creo). Revisa el email/username y reintenta."
}

# --- 2. Asignar la temporal limpia (sigue forzando cambio en 1er login) ------
aws cognito-idp admin-set-user-password `
    --user-pool-id $poolId `
    --username $Username `
    --password $TempPassword `
    --no-permanent `
    --region $region | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Fallo admin-set-user-password. El usuario '$Username' existe pero quedo SIN contrasena usable."
}

Write-Host ""
Write-Host "=== USUARIO CREADO ===" -ForegroundColor Green
Write-Host "Usuario:             $Username"
Write-Host "Email:               $Email"
Write-Host "Contrasena temporal: $TempPassword" -ForegroundColor Yellow
Write-Host ""
Write-Host "Entregale estos datos por un canal seguro (Teams / en persona)."
Write-Host "En su primer login el dashboard le pedira su contrasena definitiva."
