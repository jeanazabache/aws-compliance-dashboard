"""
audit_core.py

Audita CloudWatch Log Groups en todas las regiones habilitadas:
  - Bytes y eventos ingestados en los últimos N días (métricas IncomingBytes / IncomingLogEvents)
  - Bytes almacenados actualmente (storedBytes)
  - Retention configurada (None = nunca expira)
  - Costo estimado por ingesta (USD/GB)

El objetivo es identificar log groups que generan más costo o están
recibiendo volúmenes anómalos.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

BOTO_CONFIG = Config(retries={"max_attempts": 10, "mode": "adaptive"})

# Configuración via env vars
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "7"))
INGEST_COST_USD_PER_GB = float(os.environ.get("INGEST_COST_USD_PER_GB", "0.50"))
MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "8"))

# CloudWatch GetMetricData admite hasta 500 queries por request.
METRIC_BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class LogGroupAudit:
    """Estado y métricas de ingesta de un log group."""

    name: str
    region: str
    stored_bytes: int
    retention_days: int | None
    incoming_bytes: float
    incoming_events: float
    estimated_cost_usd: float

    @property
    def status(self) -> str:
        # "Non-compliant" si nunca expira (retention=None y tiene ingesta).
        if self.retention_days is None:
            return "Non-compliant"
        return "Compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "region": self.region,
            "stored_bytes": self.stored_bytes,
            "retention_days": self.retention_days,
            "incoming_bytes": self.incoming_bytes,
            "incoming_events": int(self.incoming_events),
            "estimated_cost_usd": round(self.estimated_cost_usd, 2),
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


def _list_log_groups(region: str) -> list[dict[str, Any]]:
    """Devuelve [{name, stored_bytes, retention_days}, ...] de la región."""
    client = boto3.client("logs", region_name=region, config=BOTO_CONFIG)
    paginator = client.get_paginator("describe_log_groups")

    log_groups: list[dict[str, Any]] = []
    try:
        for page in paginator.paginate(limit=50):
            for lg in page.get("logGroups", []):
                log_groups.append({
                    "name": lg.get("logGroupName", ""),
                    "stored_bytes": int(lg.get("storedBytes", 0) or 0),
                    "retention_days": lg.get("retentionInDays"),  # puede ser None
                })
    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — describe_log_groups falló: %s", region, exc)
        return []

    return log_groups


def _safe_metric_id(prefix: str, idx: int) -> str:
    """Genera un id válido para GetMetricData (lowercase + alphanumeric)."""
    return f"{prefix}{idx}"


def _fetch_ingest_metrics(
    region: str, log_group_names: list[str]
) -> dict[str, dict[str, float]]:
    """
    Llama a CloudWatch GetMetricData en batches y devuelve:
      { log_group_name: {"incoming_bytes": float, "incoming_events": float} }
    """
    if not log_group_names:
        return {}

    cw = boto3.client("cloudwatch", region_name=region, config=BOTO_CONFIG)
    end_time = datetime.now(tz=timezone.utc)
    start_time = end_time - timedelta(days=LOOKBACK_DAYS)
    period_seconds = max(60, LOOKBACK_DAYS * 86400)  # un solo bucket = total del rango

    results: dict[str, dict[str, float]] = {}

    # Cada log group consume 2 queries (bytes + events). Por eso /2.
    batch_size = METRIC_BATCH_SIZE // 2

    for batch_start in range(0, len(log_group_names), batch_size):
        batch = log_group_names[batch_start:batch_start + batch_size]
        queries: list[dict[str, Any]] = []
        id_to_lg: dict[str, tuple[str, str]] = {}

        for idx, name in enumerate(batch):
            bytes_id = _safe_metric_id("b", idx)
            events_id = _safe_metric_id("e", idx)
            id_to_lg[bytes_id] = (name, "incoming_bytes")
            id_to_lg[events_id] = (name, "incoming_events")

            common_dim = [{"Name": "LogGroupName", "Value": name}]
            queries.append({
                "Id": bytes_id,
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/Logs",
                        "MetricName": "IncomingBytes",
                        "Dimensions": common_dim,
                    },
                    "Period": period_seconds,
                    "Stat": "Sum",
                },
                "ReturnData": True,
            })
            queries.append({
                "Id": events_id,
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/Logs",
                        "MetricName": "IncomingLogEvents",
                        "Dimensions": common_dim,
                    },
                    "Period": period_seconds,
                    "Stat": "Sum",
                },
                "ReturnData": True,
            })

        try:
            paginator = cw.get_paginator("get_metric_data")
            for page in paginator.paginate(
                MetricDataQueries=queries,
                StartTime=start_time,
                EndTime=end_time,
                ScanBy="TimestampDescending",
            ):
                for entry in page.get("MetricDataResults", []):
                    qid = entry.get("Id", "")
                    values = entry.get("Values", [])
                    if qid not in id_to_lg:
                        continue
                    lg_name, metric_kind = id_to_lg[qid]
                    total = float(sum(values)) if values else 0.0
                    bucket = results.setdefault(
                        lg_name,
                        {"incoming_bytes": 0.0, "incoming_events": 0.0},
                    )
                    bucket[metric_kind] = total
        except (ClientError, BotoCoreError) as exc:
            logger.warning("Región %s — GetMetricData batch falló: %s", region, exc)

    return results


def _scan_region(region: str) -> list[LogGroupAudit]:
    """Inventaria log groups + métricas en una región."""
    log_groups = _list_log_groups(region)
    if not log_groups:
        logger.info("Región %s — 0 log groups", region)
        return []

    names = [lg["name"] for lg in log_groups]
    metrics = _fetch_ingest_metrics(region, names)

    audits: list[LogGroupAudit] = []
    for lg in log_groups:
        m = metrics.get(lg["name"], {})
        incoming_bytes = float(m.get("incoming_bytes", 0.0))
        incoming_events = float(m.get("incoming_events", 0.0))
        cost = (incoming_bytes / (1024 ** 3)) * INGEST_COST_USD_PER_GB

        audits.append(LogGroupAudit(
            name=lg["name"],
            region=region,
            stored_bytes=lg["stored_bytes"],
            retention_days=lg["retention_days"],
            incoming_bytes=incoming_bytes,
            incoming_events=incoming_events,
            estimated_cost_usd=cost,
        ))

    logger.info("Región %s — %d log groups auditados", region, len(audits))
    return audits


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_audit() -> list[LogGroupAudit]:
    regions = _list_enabled_regions()
    workers = max(1, min(MAX_WORKERS, len(regions)))
    logger.info("Escaneando %d regiones con %d workers", len(regions), workers)

    all_audits: list[LogGroupAudit] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_region = {pool.submit(_scan_region, r): r for r in regions}
        for future in as_completed(future_to_region):
            region = future_to_region[future]
            try:
                all_audits.extend(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.warning("Región %s — escaneo falló: %s", region, exc)

    # Orden descendente por bytes ingresados — el dashboard hereda este orden.
    all_audits.sort(key=lambda a: a.incoming_bytes, reverse=True)
    return all_audits


def build_report(
    audit_results: list[LogGroupAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.status == "Compliant")
    non_compliant = total - compliant

    total_bytes = sum(r.incoming_bytes for r in audit_results)
    total_events = sum(r.incoming_events for r in audit_results)
    total_cost = sum(r.estimated_cost_usd for r in audit_results)
    total_stored = sum(r.stored_bytes for r in audit_results)

    # Agregado por región para vista resumida.
    by_region: dict[str, dict[str, float]] = {}
    for r in audit_results:
        bucket = by_region.setdefault(r.region, {
            "log_groups": 0,
            "incoming_bytes": 0.0,
            "incoming_events": 0.0,
            "estimated_cost_usd": 0.0,
        })
        bucket["log_groups"] += 1
        bucket["incoming_bytes"] += r.incoming_bytes
        bucket["incoming_events"] += r.incoming_events
        bucket["estimated_cost_usd"] += r.estimated_cost_usd

    regions_summary = [
        {
            "region": region,
            "log_groups": int(b["log_groups"]),
            "incoming_bytes": b["incoming_bytes"],
            "incoming_events": int(b["incoming_events"]),
            "estimated_cost_usd": round(b["estimated_cost_usd"], 2),
        }
        for region, b in sorted(
            by_region.items(),
            key=lambda kv: -kv[1]["incoming_bytes"],
        )
    ]

    return {
        "script": "audit_cloudwatch_logs",
        "timestamp": timestamp,
        "account_id": account_id,
        "lookback_days": LOOKBACK_DAYS,
        "ingest_cost_usd_per_gb": INGEST_COST_USD_PER_GB,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": non_compliant,
            "skipped": 0,
            "total_incoming_bytes": total_bytes,
            "total_incoming_events": int(total_events),
            "total_stored_bytes": total_stored,
            "estimated_cost_usd": round(total_cost, 2),
        },
        "regions": regions_summary,
        "results": [r.to_dict() for r in audit_results],
    }
