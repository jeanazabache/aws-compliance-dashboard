"""
audit_core.py

Audita las distribuciones de Amazon CloudFront para verificar que cada una
tenga un Web ACL (WAF) asociado.

CloudFront es un servicio global — las distribuciones se listan desde us-east-1.
Los Web ACLs para CloudFront también deben ser de scope CLOUDFRONT (us-east-1).

Flujo:
  cloudfront:ListDistributions → revisar campo WebACLId en cada distribución
  Si WebACLId no está vacío → wafv2:GetWebACL para obtener el nombre del ACL.

Resultado:
  - Compliant: la distribución tiene un Web ACL asociado (muestra cuál es).
  - Non-compliant: la distribución NO tiene un Web ACL asociado.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

BOTO_CONFIG = Config(retries={"max_attempts": 10, "mode": "adaptive"})

_STATUS_ORDER = {"Non-compliant": 0, "Compliant": 1}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class CloudFrontAudit:
    """Estado de WAF para una distribución de CloudFront."""

    distribution_id: str
    domain_name: str
    aliases: list[str]
    status: str
    enabled: bool
    has_waf: bool
    waf_web_acl_id: str | None
    waf_web_acl_name: str | None
    waf_web_acl_arn: str | None
    comment: str

    @property
    def compliance_status(self) -> str:
        return "Compliant" if self.has_waf else "Non-compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "distribution_id": self.distribution_id,
            "domain_name": self.domain_name,
            "aliases": self.aliases,
            "distribution_status": self.status,
            "enabled": self.enabled,
            "has_waf": self.has_waf,
            "waf_web_acl_id": self.waf_web_acl_id,
            "waf_web_acl_name": self.waf_web_acl_name,
            "waf_web_acl_arn": self.waf_web_acl_arn,
            "comment": self.comment,
            "status": self.compliance_status,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_web_acl(wafv2_client: Any, web_acl_arn: str) -> dict | None:
    """
    Dado un ARN de Web ACL, obtiene su nombre e ID.
    Retorna dict con Name, Id, ARN o None si falla.
    """
    if not web_acl_arn:
        return None

    # Extraer el ID y nombre del ARN:
    # arn:aws:wafv2:us-east-1:123456789012:global/webacl/nombre/id
    try:
        parts = web_acl_arn.split("/")
        if len(parts) >= 4:
            name = parts[2]
            acl_id = parts[3]
        else:
            name = ""
            acl_id = ""

        resp = wafv2_client.get_web_acl(
            Name=name,
            Scope="CLOUDFRONT",
            Id=acl_id,
        )
        web_acl = resp.get("WebACL", {})
        return {
            "Name": web_acl.get("Name", name),
            "Id": web_acl.get("Id", acl_id),
            "ARN": web_acl.get("ARN", web_acl_arn),
        }
    except (ClientError, BotoCoreError) as exc:
        logger.warning("No se pudo resolver Web ACL %s: %s", web_acl_arn, exc)
        # Devolvemos lo que pudimos parsear del ARN
        parts = web_acl_arn.split("/")
        return {
            "Name": parts[2] if len(parts) >= 3 else "unknown",
            "Id": parts[3] if len(parts) >= 4 else "unknown",
            "ARN": web_acl_arn,
        }


def _list_distributions(cf_client: Any) -> list[dict]:
    """Lista todas las distribuciones de CloudFront usando paginación."""
    distributions: list[dict] = []
    paginator = cf_client.get_paginator("list_distributions")

    try:
        for page in paginator.paginate():
            dist_list = page.get("DistributionList", {})
            items = dist_list.get("Items", [])
            distributions.extend(items)
    except (ClientError, BotoCoreError) as exc:
        logger.warning("Error listando distribuciones CloudFront: %s", exc)

    logger.info("Distribuciones CloudFront encontradas: %d", len(distributions))
    return distributions


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_audit() -> list[CloudFrontAudit]:
    """Audita todas las distribuciones de CloudFront."""
    # CloudFront es global, se accede desde us-east-1
    cf_client = boto3.client("cloudfront", region_name="us-east-1", config=BOTO_CONFIG)
    wafv2_client = boto3.client("wafv2", region_name="us-east-1", config=BOTO_CONFIG)

    distributions = _list_distributions(cf_client)
    audits: list[CloudFrontAudit] = []

    for dist in distributions:
        dist_id = dist.get("Id", "")
        domain = dist.get("DomainName", "")
        status = dist.get("Status", "")
        enabled = dist.get("Enabled", False)
        comment = dist.get("Comment", "")

        # Aliases (CNAMEs)
        aliases_obj = dist.get("Aliases", {})
        aliases = aliases_obj.get("Items", []) if aliases_obj.get("Quantity", 0) > 0 else []

        # WebACLId en CloudFront es el ARN completo del Web ACL
        web_acl_arn = dist.get("WebACLId", "")
        has_waf = bool(web_acl_arn)

        waf_info = None
        if has_waf:
            waf_info = _resolve_web_acl(wafv2_client, web_acl_arn)

        audits.append(CloudFrontAudit(
            distribution_id=dist_id,
            domain_name=domain,
            aliases=aliases,
            status=status,
            enabled=enabled,
            has_waf=has_waf,
            waf_web_acl_id=waf_info.get("Id") if waf_info else None,
            waf_web_acl_name=waf_info.get("Name") if waf_info else None,
            waf_web_acl_arn=waf_info.get("ARN") if waf_info else web_acl_arn or None,
            comment=comment,
        ))

    # Non-compliant primero
    audits.sort(key=lambda a: (_STATUS_ORDER.get(a.compliance_status, 9), a.domain_name))
    logger.info("Auditoría completada — %d distribuciones", len(audits))
    return audits


def build_report(
    audit_results: list[CloudFrontAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    """Construye el dict del reporte con resumen y detalle."""
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.compliance_status == "Compliant")
    non_compliant = total - compliant

    # Distribuciones habilitadas vs deshabilitadas
    enabled_count = sum(1 for r in audit_results if r.enabled)
    disabled_count = total - enabled_count

    # Lista de Web ACLs únicas en uso
    waf_acls_in_use: dict[str, str] = {}
    for r in audit_results:
        if r.has_waf and r.waf_web_acl_name:
            waf_acls_in_use[r.waf_web_acl_name] = r.waf_web_acl_arn or ""

    waf_summary = [
        {"name": name, "arn": arn, "distributions": sum(
            1 for r in audit_results if r.waf_web_acl_name == name
        )}
        for name, arn in sorted(waf_acls_in_use.items())
    ]

    return {
        "script": "audit_cloudfront_waf",
        "timestamp": timestamp,
        "account_id": account_id,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": non_compliant,
            "skipped": 0,
            "enabled": enabled_count,
            "disabled": disabled_count,
        },
        "waf_acls": waf_summary,
        "results": [r.to_dict() for r in audit_results],
    }
