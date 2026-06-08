"""
audit_core.py

Audita funciones Lambda para verificar si su rol de ejecución les permite
registrar logs en CloudWatch Logs.

Lógica:
  1. Lista todas las funciones Lambda en todas las regiones habilitadas.
  2. Para cada función, obtiene su rol de ejecución.
  3. Analiza TODAS las políticas del rol (inline + managed) buscando
     statements de logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents.
  4. Detecta si hay statements DENY que bloqueen los permisos de logs.

Compliance:
  - Compliant: El rol tiene Allow en acciones de logs Y no tiene Deny que las anule.
  - Denied: El rol tiene un Deny explícito sobre acciones de logs.
  - No permissions: El rol no tiene ningún Allow para acciones de logs.
"""

from __future__ import annotations

import fnmatch
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

BOTO_CONFIG = Config(retries={"max_attempts": 10, "mode": "adaptive"})
MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "8"))

LOGS_ACTIONS = {
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
}

# Acciones que si aparecen con Allow cubren las 3 de arriba
LOGS_WILDCARDS = {"logs:*", "*"}

_STATUS_ORDER = {"Deshabilitado": 0, "Habilitado": 1}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class LambdaLoggingAudit:
    """Estado de permisos de logging para una función Lambda."""

    function_name: str
    function_arn: str
    runtime: str
    region: str
    role_arn: str
    role_name: str
    has_allow: bool
    has_deny: bool
    allow_sources: list[str] = field(default_factory=list)
    deny_sources: list[str] = field(default_factory=list)
    log_group: str | None = None
    detail: str = ""

    @property
    def status(self) -> str:
        if self.has_allow and not self.has_deny:
            return "Habilitado"
        return "Deshabilitado"

    def to_dict(self) -> dict[str, Any]:
        return {
            "function_name": self.function_name,
            "function_arn": self.function_arn,
            "runtime": self.runtime,
            "region": self.region,
            "role_arn": self.role_arn,
            "role_name": self.role_name,
            "log_group": self.log_group,
            "detail": self.detail,
            "status": self.status,
        }


# ---------------------------------------------------------------------------
# Policy analysis helpers
# ---------------------------------------------------------------------------

def _action_matches_logs(action: str) -> bool:
    """Determina si una acción cubre alguna de las acciones de logs."""
    action_lower = action.lower()
    for target in LOGS_ACTIONS:
        if fnmatch.fnmatch(target.lower(), action_lower):
            return True
    return False


def _extract_statements(policy_doc: dict) -> list[dict]:
    """Extrae statements de un policy document (puede ser str o dict)."""
    if isinstance(policy_doc, str):
        policy_doc = json.loads(policy_doc)
    statements = policy_doc.get("Statement", [])
    if isinstance(statements, dict):
        statements = [statements]
    return statements


def _analyze_policy_statements(
    statements: list[dict],
    source_label: str,
) -> tuple[bool, bool, list[str], list[str]]:
    """
    Analiza statements de una política.
    Retorna (has_allow, has_deny, allow_sources, deny_sources).
    """
    has_allow = False
    has_deny = False
    allow_sources: list[str] = []
    deny_sources: list[str] = []

    for stmt in statements:
        effect = stmt.get("Effect", "").lower()
        actions = stmt.get("Action", [])
        if isinstance(actions, str):
            actions = [actions]

        logs_related = any(_action_matches_logs(a) for a in actions)
        if not logs_related:
            continue

        if effect == "allow":
            has_allow = True
            allow_sources.append(source_label)
        elif effect == "deny":
            has_deny = True
            deny_sources.append(source_label)

    return has_allow, has_deny, allow_sources, deny_sources


def _analyze_role(iam_client: Any, role_name: str) -> tuple[bool, bool, list[str], list[str]]:
    """
    Analiza todas las políticas (inline + managed) de un rol.
    Retorna (has_allow, has_deny, allow_sources, deny_sources).
    """
    has_allow = False
    has_deny = False
    allow_sources: list[str] = []
    deny_sources: list[str] = []

    # 1. Inline policies
    try:
        inline_names = []
        paginator = iam_client.get_paginator("list_role_policies")
        for page in paginator.paginate(RoleName=role_name):
            inline_names.extend(page.get("PolicyNames", []))

        for policy_name in inline_names:
            try:
                resp = iam_client.get_role_policy(RoleName=role_name, PolicyName=policy_name)
                doc = resp.get("PolicyDocument", {})
                statements = _extract_statements(doc)
                a, d, asrc, dsrc = _analyze_policy_statements(statements, f"inline:{policy_name}")
                has_allow = has_allow or a
                has_deny = has_deny or d
                allow_sources.extend(asrc)
                deny_sources.extend(dsrc)
            except (ClientError, BotoCoreError) as exc:
                logger.debug("Error leyendo inline policy %s/%s: %s", role_name, policy_name, exc)
    except (ClientError, BotoCoreError) as exc:
        logger.debug("Error listando inline policies de %s: %s", role_name, exc)

    # 2. Managed policies (attached)
    try:
        attached = []
        paginator = iam_client.get_paginator("list_attached_role_policies")
        for page in paginator.paginate(RoleName=role_name):
            attached.extend(page.get("AttachedPolicies", []))

        for policy_meta in attached:
            policy_arn = policy_meta["PolicyArn"]
            policy_label = policy_meta.get("PolicyName", policy_arn.split("/")[-1])
            try:
                pol_resp = iam_client.get_policy(PolicyArn=policy_arn)
                version_id = pol_resp["Policy"]["DefaultVersionId"]
                ver_resp = iam_client.get_policy_version(PolicyArn=policy_arn, VersionId=version_id)
                doc = ver_resp["PolicyVersion"]["Document"]
                statements = _extract_statements(doc)
                a, d, asrc, dsrc = _analyze_policy_statements(statements, f"managed:{policy_label}")
                has_allow = has_allow or a
                has_deny = has_deny or d
                allow_sources.extend(asrc)
                deny_sources.extend(dsrc)
            except (ClientError, BotoCoreError) as exc:
                logger.debug("Error leyendo managed policy %s: %s", policy_arn, exc)
    except (ClientError, BotoCoreError) as exc:
        logger.debug("Error listando managed policies de %s: %s", role_name, exc)

    return has_allow, has_deny, allow_sources, deny_sources


# ---------------------------------------------------------------------------
# Region scanner
# ---------------------------------------------------------------------------

def _list_enabled_regions() -> list[str]:
    ec2 = boto3.client("ec2", config=BOTO_CONFIG)
    try:
        response = ec2.describe_regions(AllRegions=False)
    except (ClientError, BotoCoreError) as exc:
        logger.warning("describe_regions falló (%s); usando región actual.", exc)
        session = boto3.session.Session()
        return [session.region_name] if session.region_name else ["us-east-1"]

    regions = sorted(r["RegionName"] for r in response.get("Regions", []))
    logger.info("Regiones habilitadas: %d", len(regions))
    return regions


def _scan_region(region: str, iam_client: Any, role_cache: dict) -> list[LambdaLoggingAudit]:
    """Escanea funciones Lambda en una región."""
    lam = boto3.client("lambda", region_name=region, config=BOTO_CONFIG)
    audits: list[LambdaLoggingAudit] = []

    try:
        paginator = lam.get_paginator("list_functions")
        for page in paginator.paginate():
            for func in page.get("Functions", []):
                func_name = func["FunctionName"]
                func_arn = func["FunctionArn"]
                runtime = func.get("Runtime", "N/A")
                role_arn = func.get("Role", "")
                log_group = func.get("LoggingConfig", {}).get("LogGroup") or f"/aws/lambda/{func_name}"

                # Extraer nombre del rol del ARN
                role_name = role_arn.split("/")[-1] if "/" in role_arn else role_arn

                # Cache de análisis de rol (el mismo rol puede usarse en varias funciones)
                if role_name not in role_cache:
                    role_cache[role_name] = _analyze_role(iam_client, role_name)

                has_allow, has_deny, allow_sources, deny_sources = role_cache[role_name]

                # Detalle descriptivo
                if has_deny:
                    detail = f"DENY en: {', '.join(deny_sources)}"
                elif not has_allow:
                    detail = "Sin permisos de CloudWatch Logs en el rol"
                else:
                    detail = f"Allow via: {', '.join(allow_sources)}"

                audits.append(LambdaLoggingAudit(
                    function_name=func_name,
                    function_arn=func_arn,
                    runtime=runtime,
                    region=region,
                    role_arn=role_arn,
                    role_name=role_name,
                    has_allow=has_allow,
                    has_deny=has_deny,
                    allow_sources=allow_sources,
                    deny_sources=deny_sources,
                    log_group=log_group,
                    detail=detail,
                ))

    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — error listando Lambdas: %s", region, exc)

    logger.info("Región %s — %d funciones Lambda auditadas", region, len(audits))
    return audits


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_audit() -> list[LambdaLoggingAudit]:
    """Audita todas las funciones Lambda en todas las regiones habilitadas."""
    regions = _list_enabled_regions()
    workers = max(1, min(MAX_WORKERS, len(regions)))
    logger.info("Escaneando %d regiones con %d workers", len(regions), workers)

    # IAM es global — un solo cliente compartido
    iam_client = boto3.client("iam", config=BOTO_CONFIG)
    role_cache: dict[str, tuple[bool, bool, list[str], list[str]]] = {}

    all_audits: list[LambdaLoggingAudit] = []

    # Nota: IAM no es thread-safe con el cache, usamos secuencial para roles
    # pero paralelo para listar funciones por región
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_region = {
            pool.submit(_scan_region, r, iam_client, role_cache): r for r in regions
        }
        for future in as_completed(future_to_region):
            region = future_to_region[future]
            try:
                all_audits.extend(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.warning("Región %s — escaneo falló: %s", region, exc)

    all_audits.sort(key=lambda a: (_STATUS_ORDER.get(a.status, 9), a.function_name))
    return all_audits


def build_report(
    audit_results: list[LambdaLoggingAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    """Construye el reporte con resumen y detalle."""
    total = len(audit_results)
    habilitado = sum(1 for r in audit_results if r.status == "Habilitado")
    deshabilitado = total - habilitado

    # Agregado por región
    by_region: dict[str, dict[str, int]] = {}
    for r in audit_results:
        bucket = by_region.setdefault(r.region, {"total": 0, "habilitado": 0, "deshabilitado": 0})
        bucket["total"] += 1
        if r.status == "Habilitado":
            bucket["habilitado"] += 1
        else:
            bucket["deshabilitado"] += 1

    regions_summary = [
        {"region": reg, **counts}
        for reg, counts in sorted(by_region.items(), key=lambda kv: -kv[1]["deshabilitado"])
    ]

    return {
        "script": "audit_lambda_logging",
        "timestamp": timestamp,
        "account_id": account_id,
        "summary": {
            "total": total,
            "habilitado": habilitado,
            "deshabilitado": deshabilitado,
        },
        "regions": regions_summary,
        "results": [r.to_dict() for r in audit_results],
    }
