"""
audit_core.py

Audita los recursos de API Gateway (REST APIs y HTTP APIs) en todas las
regiones habilitadas para verificar que cada stage tenga un Web ACL (WAF)
asociado.

Flujo por región:
  apigateway:GetRestApis → apigateway:GetStages → wafv2:GetWebACLForResource
  apigatewayv2:GetApis   → apigatewayv2:GetStages → wafv2:GetWebACLForResource

Resultado:
  - Compliant: el stage tiene un Web ACL asociado (muestra cuál es).
  - Non-compliant: el stage NO tiene un Web ACL asociado.
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
class ApiGatewayAudit:
    """Estado de WAF para un stage de API Gateway."""

    api_id: str
    api_name: str
    api_type: str  # "REST" o "HTTP"
    stage_name: str
    region: str
    has_waf: bool
    waf_web_acl_name: str | None
    waf_web_acl_id: str | None
    waf_web_acl_arn: str | None

    @property
    def status(self) -> str:
        return "Compliant" if self.has_waf else "Non-compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "api_id": self.api_id,
            "api_name": self.api_name,
            "api_type": self.api_type,
            "stage_name": self.stage_name,
            "region": self.region,
            "has_waf": self.has_waf,
            "waf_web_acl_name": self.waf_web_acl_name,
            "waf_web_acl_id": self.waf_web_acl_id,
            "waf_web_acl_arn": self.waf_web_acl_arn,
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


def _check_waf_for_resource(wafv2_client: Any, resource_arn: str) -> dict | None:
    """
    Consulta si un recurso tiene un Web ACL asociado.
    Retorna el dict del WebACL si existe, None si no.
    """
    try:
        resp = wafv2_client.get_web_acl_for_resource(ResourceArn=resource_arn)
        web_acl = resp.get("WebACL")
        return web_acl if web_acl else None
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code in ("WAFNonexistentItemException", "WAFInvalidParameterException"):
            return None
        logger.warning("wafv2:GetWebACLForResource falló para %s: %s", resource_arn, exc)
        return None
    except BotoCoreError as exc:
        logger.warning("wafv2:GetWebACLForResource falló para %s: %s", resource_arn, exc)
        return None


def _scan_rest_apis(region: str, account_id: str) -> list[ApiGatewayAudit]:
    """Escanea REST APIs (API Gateway v1) en una región."""
    apigw = boto3.client("apigateway", region_name=region, config=BOTO_CONFIG)
    wafv2 = boto3.client("wafv2", region_name=region, config=BOTO_CONFIG)
    audits: list[ApiGatewayAudit] = []

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
                    resource_arn = (
                        f"arn:aws:apigateway:{region}::/restapis/{api_id}/stages/{stage_name}"
                    )

                    web_acl = _check_waf_for_resource(wafv2, resource_arn)

                    audits.append(ApiGatewayAudit(
                        api_id=api_id,
                        api_name=api_name,
                        api_type="REST",
                        stage_name=stage_name,
                        region=region,
                        has_waf=web_acl is not None,
                        waf_web_acl_name=web_acl.get("Name") if web_acl else None,
                        waf_web_acl_id=web_acl.get("Id") if web_acl else None,
                        waf_web_acl_arn=web_acl.get("ARN") if web_acl else None,
                    ))

    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — error listando REST APIs: %s", region, exc)

    return audits


def _scan_http_apis(region: str, account_id: str) -> list[ApiGatewayAudit]:
    """Escanea HTTP APIs (API Gateway v2) en una región."""
    apigwv2 = boto3.client("apigatewayv2", region_name=region, config=BOTO_CONFIG)
    wafv2 = boto3.client("wafv2", region_name=region, config=BOTO_CONFIG)
    audits: list[ApiGatewayAudit] = []

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
                    resource_arn = (
                        f"arn:aws:apigateway:{region}::/apis/{api_id}/stages/{stage_name}"
                    )

                    web_acl = _check_waf_for_resource(wafv2, resource_arn)

                    audits.append(ApiGatewayAudit(
                        api_id=api_id,
                        api_name=api_name,
                        api_type="HTTP",
                        stage_name=stage_name,
                        region=region,
                        has_waf=web_acl is not None,
                        waf_web_acl_name=web_acl.get("Name") if web_acl else None,
                        waf_web_acl_id=web_acl.get("Id") if web_acl else None,
                        waf_web_acl_arn=web_acl.get("ARN") if web_acl else None,
                    ))

    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — error listando HTTP APIs: %s", region, exc)

    return audits


def _scan_region(region: str, account_id: str) -> list[ApiGatewayAudit]:
    """Escanea REST y HTTP APIs en una región."""
    audits: list[ApiGatewayAudit] = []
    audits.extend(_scan_rest_apis(region, account_id))
    audits.extend(_scan_http_apis(region, account_id))
    logger.info("Región %s — %d stages de API Gateway auditados", region, len(audits))
    return audits


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_audit(account_id: str) -> list[ApiGatewayAudit]:
    """Audita todos los stages de API Gateway en todas las regiones habilitadas."""
    regions = _list_enabled_regions()
    workers = max(1, min(MAX_WORKERS, len(regions)))
    logger.info("Escaneando %d regiones con %d workers", len(regions), workers)

    all_audits: list[ApiGatewayAudit] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_region = {
            pool.submit(_scan_region, r, account_id): r for r in regions
        }
        for future in as_completed(future_to_region):
            region = future_to_region[future]
            try:
                all_audits.extend(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.warning("Región %s — escaneo falló: %s", region, exc)

    # Non-compliant primero, luego por nombre de API.
    all_audits.sort(key=lambda a: (_STATUS_ORDER.get(a.status, 9), a.api_name, a.stage_name))
    return all_audits


def build_report(
    audit_results: list[ApiGatewayAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    """Construye el dict del reporte con resumen y detalle."""
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.status == "Compliant")
    non_compliant = total - compliant

    # Agregado por región para vista resumida.
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

    # Agregado por tipo de API (REST vs HTTP).
    by_type: dict[str, dict[str, int]] = {}
    for r in audit_results:
        bucket = by_type.setdefault(r.api_type, {"total": 0, "compliant": 0, "non_compliant": 0})
        bucket["total"] += 1
        if r.status == "Compliant":
            bucket["compliant"] += 1
        else:
            bucket["non_compliant"] += 1

    return {
        "script": "audit_apigateway_waf",
        "timestamp": timestamp,
        "account_id": account_id,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": non_compliant,
            "skipped": 0,
        },
        "regions": regions_summary,
        "by_type": by_type,
        "results": [r.to_dict() for r in audit_results],
    }
