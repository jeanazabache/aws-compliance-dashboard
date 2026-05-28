"""
audit_core.py

Lógica de auditoría del tag obligatorio `t.aplicacion` en todos los
recursos taggable de la cuenta AWS.

Usa la Resource Groups Tagging API, que indexa los recursos taggable
por región. Para cubrir toda la cuenta iteramos las regiones habilitadas.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

REQUIRED_TAG_KEY = "t.aplicacion"

# Config con retries adaptativos (la Tagging API tiene throttling agresivo).
BOTO_CONFIG = Config(retries={"max_attempts": 10, "mode": "adaptive"})

# Paralelismo del escaneo por región. Configurable vía env var.
MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "8"))


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ResourceAudit:
    """Estado del tag `t.aplicacion` para un recurso AWS."""

    arn: str
    service: str
    resource_type: str
    region: str
    has_required_tag: bool
    tag_value: str | None

    @property
    def status(self) -> str:
        if self.has_required_tag and self.tag_value:
            return "Compliant"
        return "Non-compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "arn": self.arn,
            "service": self.service,
            "resource_type": self.resource_type,
            "region": self.region,
            "has_required_tag": self.has_required_tag,
            "tag_value": self.tag_value,
            "status": self.status,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _list_enabled_regions() -> list[str]:
    """Devuelve la lista de regiones habilitadas en la cuenta."""
    ec2 = boto3.client("ec2", config=BOTO_CONFIG)
    try:
        response = ec2.describe_regions(AllRegions=False)
    except (ClientError, BotoCoreError) as exc:
        logger.warning("describe_regions falló (%s); usando región actual del Lambda.", exc)
        session = boto3.session.Session()
        return [session.region_name] if session.region_name else ["us-east-1"]

    regions = sorted(r["RegionName"] for r in response.get("Regions", []))
    logger.info("Regiones habilitadas: %d", len(regions))
    return regions


def _parse_arn(arn: str) -> tuple[str, str, str]:
    """
    Extrae (service, region, resource_type) desde un ARN.

    ARN formato: arn:aws:<service>:<region>:<account>:<resource_type>[/:]<resource_id>
    """
    parts = arn.split(":", 5)
    if len(parts) < 6:
        return ("unknown", "", "unknown")

    service = parts[2] or "unknown"
    region = parts[3] or "global"
    resource_part = parts[5]

    # El resource_type puede venir separado por ":" o "/" (depende del servicio).
    if ":" in resource_part:
        resource_type = resource_part.split(":", 1)[0]
    elif "/" in resource_part:
        resource_type = resource_part.split("/", 1)[0]
    else:
        resource_type = resource_part

    return (service, region, resource_type or service)


def _scan_region(region: str) -> list[ResourceAudit]:
    """Escanea todos los recursos taggable de una región."""
    client = boto3.client("resourcegroupstaggingapi", region_name=region, config=BOTO_CONFIG)
    paginator = client.get_paginator("get_resources")

    audits: list[ResourceAudit] = []
    try:
        for page in paginator.paginate(ResourcesPerPage=100):
            for item in page.get("ResourceTagMappingList", []):
                arn = item.get("ResourceARN", "")
                tags = {t["Key"]: t.get("Value") or "" for t in item.get("Tags", [])}
                tag_value = tags.get(REQUIRED_TAG_KEY)

                service, arn_region, resource_type = _parse_arn(arn)
                audits.append(ResourceAudit(
                    arn=arn,
                    service=service,
                    resource_type=resource_type,
                    region=arn_region or region,
                    has_required_tag=REQUIRED_TAG_KEY in tags and bool(tag_value),
                    tag_value=tag_value if tag_value else None,
                ))
    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — error escaneando recursos: %s", region, exc)

    logger.info("Región %s — %d recursos auditados", region, len(audits))
    return audits


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

def run_audit() -> list[ResourceAudit]:
    """Audita todos los recursos taggable de todas las regiones habilitadas en paralelo."""
    regions = _list_enabled_regions()
    all_audits: list[ResourceAudit] = []

    workers = max(1, min(MAX_WORKERS, len(regions)))
    logger.info("Escaneando %d regiones con %d workers", len(regions), workers)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_region = {pool.submit(_scan_region, r): r for r in regions}
        for future in as_completed(future_to_region):
            region = future_to_region[future]
            try:
                all_audits.extend(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.warning("Región %s — escaneo falló: %s", region, exc)

    return all_audits


def build_report(
    audit_results: list[ResourceAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    """Construye el dict del reporte con resumen, agregado por servicio y detalle."""
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.status == "Compliant")
    non_compliant = total - compliant

    # Agregado por servicio para vista resumida en el dashboard.
    by_service: dict[str, dict[str, int]] = {}
    for r in audit_results:
        bucket = by_service.setdefault(r.service, {"total": 0, "compliant": 0, "non_compliant": 0})
        bucket["total"] += 1
        if r.status == "Compliant":
            bucket["compliant"] += 1
        else:
            bucket["non_compliant"] += 1

    services_summary = [
        {"service": svc, **counts}
        for svc, counts in sorted(by_service.items(), key=lambda kv: -kv[1]["non_compliant"])
    ]

    return {
        "script": "audit_aws_tags",
        "timestamp": timestamp,
        "account_id": account_id,
        "required_tag": REQUIRED_TAG_KEY,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": non_compliant,
            "skipped": 0,
        },
        "services": services_summary,
        "results": [r.to_dict() for r in audit_results],
    }
