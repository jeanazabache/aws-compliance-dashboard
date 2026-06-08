"""
audit_core.py

Audita los stages de API Gateway (REST y HTTP) para verificar que tengan
habilitados los logs de acceso (Access Logging) y tracing (X-Ray).

REST APIs (v1):
  - Access Logging: stage.accessLogSettings no vacío.
  - Execution Logging: stage.methodSettings['*/*'].loggingLevel != "OFF"
  - X-Ray Tracing: stage.tracingEnabled = true

HTTP APIs (v2):
  - Access Logging: stage.accessLogSettings no vacío.
  - (HTTP APIs no soportan execution logging ni X-Ray tracing nativamente)

Resultado:
  - Compliant: tiene access logging Y tracing habilitado (REST) o access logging (HTTP).
  - Non-compliant: le falta alguno de los requisitos.
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

BOTO_CONFIG = Config(retries={"max_attempts": 10, "mode": "adaptive"})
MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "8"))

_STATUS_ORDER = {"Non-compliant": 0, "Compliant": 1}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ApiLogsAudit:
    """Estado de logging y tracing para un stage de API Gateway."""

    api_id: str
    api_name: str
    api_type: str  # "REST" o "HTTP"
    stage_name: str
    region: str
    has_access_logging: bool
    access_log_destination: str | None
    has_execution_logging: bool
    execution_log_level: str | None
    has_tracing: bool
    detail: str

    @property
    def status(self) -> str:
        if self.api_type == "REST":
            return "Compliant" if (self.has_access_logging and self.has_tracing) else "Non-compliant"
        # HTTP APIs: solo se evalúa access logging
        return "Compliant" if self.has_access_logging else "Non-compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "api_id": self.api_id,
            "api_name": self.api_name,
            "api_type": self.api_type,
            "stage_name": self.stage_name,
            "region": self.region,
            "has_access_logging": self.has_access_logging,
            "access_log_destination": self.access_log_destination,
            "has_execution_logging": self.has_execution_logging,
            "execution_log_level": self.execution_log_level,
            "has_tracing": self.has_tracing,
            "detail": self.detail,
            "status": self.status,
        }


# ---------------------------------------------------------------------------
# Helpers
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


def _scan_rest_apis(region: str) -> list[ApiLogsAudit]:
    """Escanea REST APIs (v1) — verifica access logging, execution logging y X-Ray."""
    apigw = boto3.client("apigateway", region_name=region, config=BOTO_CONFIG)
    audits: list[ApiLogsAudit] = []

    try:
        paginator = apigw.get_paginator("get_rest_apis")
        for page in paginator.paginate():
            for api in page.get("items", []):
                api_id = api["id"]
                api_name = api.get("name", api_id)

                try:
                    stages_resp = apigw.get_stages(restApiId=api_id)
                    stages = stages_resp.get("item", [])
                except (ClientError, BotoCoreError) as exc:
                    logger.warning("get_stages falló para REST API %s: %s", api_id, exc)
                    stages = []

                for stage in stages:
                    stage_name = stage.get("stageName", "unknown")

                    # Access Logging
                    access_log_settings = stage.get("accessLogSettings") or {}
                    access_log_arn = access_log_settings.get("destinationArn", "")
                    has_access_logging = bool(access_log_arn)

                    # Execution Logging
                    method_settings = stage.get("methodSettings") or {}
                    wildcard = method_settings.get("*/*") or {}
                    logging_level = wildcard.get("loggingLevel", "OFF")
                    has_execution_logging = logging_level != "OFF"

                    # X-Ray Tracing
                    has_tracing = stage.get("tracingEnabled", False)

                    # Detalle para la UI
                    issues = []
                    if not has_access_logging:
                        issues.append("Sin access logging")
                    if not has_execution_logging:
                        issues.append(f"Execution logging: {logging_level}")
                    if not has_tracing:
                        issues.append("X-Ray tracing deshabilitado")
                    detail = " · ".join(issues) if issues else "Logging completo"

                    audits.append(ApiLogsAudit(
                        api_id=api_id,
                        api_name=api_name,
                        api_type="REST",
                        stage_name=stage_name,
                        region=region,
                        has_access_logging=has_access_logging,
                        access_log_destination=access_log_arn or None,
                        has_execution_logging=has_execution_logging,
                        execution_log_level=logging_level,
                        has_tracing=has_tracing,
                        detail=detail,
                    ))

    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — error listando REST APIs: %s", region, exc)

    return audits


def _scan_http_apis(region: str) -> list[ApiLogsAudit]:
    """Escanea HTTP APIs (v2) — verifica access logging."""
    apigwv2 = boto3.client("apigatewayv2", region_name=region, config=BOTO_CONFIG)
    audits: list[ApiLogsAudit] = []

    try:
        paginator = apigwv2.get_paginator("get_apis")
        for page in paginator.paginate():
            for api in page.get("Items", []):
                api_id = api["ApiId"]
                api_name = api.get("Name", api_id)

                try:
                    stages_resp = apigwv2.get_stages(ApiId=api_id)
                    stages = stages_resp.get("Items", [])
                except (ClientError, BotoCoreError) as exc:
                    logger.warning("get_stages falló para HTTP API %s: %s", api_id, exc)
                    stages = []

                for stage in stages:
                    stage_name = stage.get("StageName", "$default")

                    # Access Logging
                    access_log_settings = stage.get("AccessLogSettings") or {}
                    access_log_arn = access_log_settings.get("DestinationArn", "")
                    has_access_logging = bool(access_log_arn)

                    detail = "Access logging habilitado" if has_access_logging else "Sin access logging"

                    audits.append(ApiLogsAudit(
                        api_id=api_id,
                        api_name=api_name,
                        api_type="HTTP",
                        stage_name=stage_name,
                        region=region,
                        has_access_logging=has_access_logging,
                        access_log_destination=access_log_arn or None,
                        has_execution_logging=False,
                        execution_log_level=None,
                        has_tracing=False,
                        detail=detail,
                    ))

    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — error listando HTTP APIs: %s", region, exc)

    return audits


def _scan_region(region: str) -> list[ApiLogsAudit]:
    audits: list[ApiLogsAudit] = []
    audits.extend(_scan_rest_apis(region))
    audits.extend(_scan_http_apis(region))
    logger.info("Región %s — %d stages auditados (logs & tracing)", region, len(audits))
    return audits


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_audit() -> list[ApiLogsAudit]:
    """Audita todos los stages de API Gateway en todas las regiones habilitadas."""
    regions = _list_enabled_regions()
    workers = max(1, min(MAX_WORKERS, len(regions)))
    logger.info("Escaneando %d regiones con %d workers", len(regions), workers)

    all_audits: list[ApiLogsAudit] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_region = {pool.submit(_scan_region, r): r for r in regions}
        for future in as_completed(future_to_region):
            region = future_to_region[future]
            try:
                all_audits.extend(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.warning("Región %s — escaneo falló: %s", region, exc)

    all_audits.sort(key=lambda a: (_STATUS_ORDER.get(a.status, 9), a.api_name, a.stage_name))
    return all_audits


def build_report(
    audit_results: list[ApiLogsAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    """Construye el reporte con resumen y detalle."""
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.status == "Compliant")
    non_compliant = total - compliant

    # Conteos individuales
    with_access_log = sum(1 for r in audit_results if r.has_access_logging)
    with_exec_log = sum(1 for r in audit_results if r.has_execution_logging)
    with_tracing = sum(1 for r in audit_results if r.has_tracing)

    # Agregado por región
    by_region: dict[str, dict[str, int]] = {}
    for r in audit_results:
        bucket = by_region.setdefault(r.region, {"total": 0, "compliant": 0, "non_compliant": 0})
        bucket["total"] += 1
        if r.status == "Compliant":
            bucket["compliant"] += 1
        else:
            bucket["non_compliant"] += 1

    regions_summary = [
        {"region": reg, **counts}
        for reg, counts in sorted(by_region.items(), key=lambda kv: -kv[1]["non_compliant"])
    ]

    # Agregado por tipo
    by_type: dict[str, dict[str, int]] = {}
    for r in audit_results:
        bucket = by_type.setdefault(r.api_type, {"total": 0, "compliant": 0, "non_compliant": 0})
        bucket["total"] += 1
        if r.status == "Compliant":
            bucket["compliant"] += 1
        else:
            bucket["non_compliant"] += 1

    return {
        "script": "audit_apigateway_logs",
        "timestamp": timestamp,
        "account_id": account_id,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": non_compliant,
            "skipped": 0,
            "with_access_log": with_access_log,
            "with_execution_log": with_exec_log,
            "with_tracing": with_tracing,
        },
        "regions": regions_summary,
        "by_type": by_type,
        "results": [r.to_dict() for r in audit_results],
    }
