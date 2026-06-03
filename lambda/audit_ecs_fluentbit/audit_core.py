"""
audit_core.py

Audita servicios de Amazon ECS en todas las regiones habilitadas para verificar
que su task definition incluya el contenedor sidecar de Fluent Bit
(`agent-fluentbit` por defecto).

Flujo por región:
  ecs:ListClusters → ecs:ListServices → ecs:DescribeServices (lotes de 10)
  → ecs:DescribeTaskDefinition (cache por ARN) → buscar el contenedor objetivo.

El objetivo es verificar el cumplimiento del estándar de observabilidad:
todo servicio ECS debe enviar sus logs mediante el sidecar de Fluent Bit.
"""

from __future__ import annotations

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

# Configuración vía env vars
MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "8"))
FLUENTBIT_CONTAINER_NAME = os.environ.get("FLUENTBIT_CONTAINER_NAME", "agent-fluentbit")

# DescribeServices admite hasta 10 servicios por llamada.
DESCRIBE_SERVICES_BATCH = 10

# Orden de severidad para el reporte (lo que necesita atención primero).
_STATUS_ORDER = {"Non-compliant": 0, "Skipped": 1, "Compliant": 2}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ServiceAudit:
    """Estado de cumplimiento de Fluent Bit para un servicio ECS."""

    cluster: str
    service: str
    region: str
    task_definition: str
    desired_count: int
    running_count: int
    launch_type: str
    containers: list[str] = field(default_factory=list)
    has_fluentbit: bool = False
    skipped_reason: str | None = None

    @property
    def status(self) -> str:
        if self.skipped_reason:
            return "Skipped"
        return "Compliant" if self.has_fluentbit else "Non-compliant"

    def to_dict(self) -> dict[str, Any]:
        return {
            "cluster": self.cluster,
            "service": self.service,
            "region": self.region,
            "task_definition": self.task_definition,
            "desired_count": self.desired_count,
            "running_count": self.running_count,
            "launch_type": self.launch_type,
            "containers": self.containers,
            "has_fluentbit": self.has_fluentbit,
            "status": self.status,
            "detail": self.skipped_reason or "",
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


def _short_name(arn_or_name: str) -> str:
    """Extrae el nombre corto desde un ARN o lo devuelve tal cual."""
    if not arn_or_name:
        return ""
    # ARN de cluster: arn:aws:ecs:region:acct:cluster/<name>
    # ARN de servicio: arn:aws:ecs:region:acct:service/<cluster>/<name>
    if "/" in arn_or_name:
        return arn_or_name.split("/")[-1]
    return arn_or_name


def _task_def_label(task_def_arn: str) -> str:
    """'arn:...:task-definition/familia:7' → 'familia:7'."""
    if not task_def_arn:
        return ""
    return task_def_arn.split("/")[-1]


def _list_clusters(client: Any) -> list[str]:
    clusters: list[str] = []
    paginator = client.get_paginator("list_clusters")
    for page in paginator.paginate():
        clusters.extend(page.get("clusterArns", []))
    return clusters


def _list_services(client: Any, cluster_arn: str) -> list[str]:
    services: list[str] = []
    paginator = client.get_paginator("list_services")
    for page in paginator.paginate(cluster=cluster_arn):
        services.extend(page.get("serviceArns", []))
    return services


def _describe_services(client: Any, cluster_arn: str, service_arns: list[str]) -> list[dict[str, Any]]:
    """DescribeServices en lotes de 10."""
    described: list[dict[str, Any]] = []
    for i in range(0, len(service_arns), DESCRIBE_SERVICES_BATCH):
        batch = service_arns[i:i + DESCRIBE_SERVICES_BATCH]
        try:
            resp = client.describe_services(cluster=cluster_arn, services=batch)
            described.extend(resp.get("services", []))
        except (ClientError, BotoCoreError) as exc:
            logger.warning(
                "describe_services falló (cluster=%s, batch=%d): %s",
                _short_name(cluster_arn), len(batch), exc,
            )
    return described


def _get_task_def_containers(
    client: Any, task_def_arn: str, cache: dict[str, list[str] | None]
) -> list[str] | None:
    """
    Devuelve la lista de nombres de contenedores de una task definition.
    Usa cache por ARN. Devuelve None si no se pudo describir (→ Skipped).
    """
    if task_def_arn in cache:
        return cache[task_def_arn]

    try:
        resp = client.describe_task_definition(taskDefinition=task_def_arn)
        containers = [
            c.get("name", "")
            for c in resp.get("taskDefinition", {}).get("containerDefinitions", [])
        ]
        cache[task_def_arn] = containers
        return containers
    except (ClientError, BotoCoreError) as exc:
        logger.warning("describe_task_definition falló (%s): %s", task_def_arn, exc)
        cache[task_def_arn] = None
        return None


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

def _scan_region(region: str) -> list[ServiceAudit]:
    """Recorre clusters → servicios → task definitions en una región."""
    client = boto3.client("ecs", region_name=region, config=BOTO_CONFIG)

    try:
        cluster_arns = _list_clusters(client)
    except (ClientError, BotoCoreError) as exc:
        logger.warning("Región %s — list_clusters falló: %s", region, exc)
        return []

    if not cluster_arns:
        logger.info("Región %s — 0 clusters ECS", region)
        return []

    task_def_cache: dict[str, list[str] | None] = {}
    audits: list[ServiceAudit] = []

    for cluster_arn in cluster_arns:
        cluster_name = _short_name(cluster_arn)
        try:
            service_arns = _list_services(client, cluster_arn)
        except (ClientError, BotoCoreError) as exc:
            logger.warning("Región %s cluster %s — list_services falló: %s", region, cluster_name, exc)
            continue

        if not service_arns:
            logger.info("Región %s cluster %s — 0 servicios", region, cluster_name)
            continue

        for svc in _describe_services(client, cluster_arn, service_arns):
            service_name = svc.get("serviceName", _short_name(svc.get("serviceArn", "")))
            task_def_arn = svc.get("taskDefinition", "")
            desired = int(svc.get("desiredCount", 0) or 0)
            running = int(svc.get("runningCount", 0) or 0)
            launch_type = svc.get("launchType", "") or ""

            audit = ServiceAudit(
                cluster=cluster_name,
                service=service_name,
                region=region,
                task_definition=_task_def_label(task_def_arn),
                desired_count=desired,
                running_count=running,
                launch_type=launch_type,
            )

            containers = _get_task_def_containers(client, task_def_arn, task_def_cache)
            if containers is None:
                audit.skipped_reason = "No se pudo describir la task definition"
            else:
                audit.containers = containers
                audit.has_fluentbit = FLUENTBIT_CONTAINER_NAME in containers

            audits.append(audit)

    logger.info("Región %s — %d servicios auditados (%d clusters)", region, len(audits), len(cluster_arns))
    return audits


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_audit() -> list[ServiceAudit]:
    regions = _list_enabled_regions()
    workers = max(1, min(MAX_WORKERS, len(regions)))
    logger.info("Escaneando %d regiones con %d workers — buscando contenedor '%s'",
                len(regions), workers, FLUENTBIT_CONTAINER_NAME)

    all_audits: list[ServiceAudit] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_region = {pool.submit(_scan_region, r): r for r in regions}
        for future in as_completed(future_to_region):
            region = future_to_region[future]
            try:
                all_audits.extend(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.warning("Región %s — escaneo falló: %s", region, exc)

    # Orden: Non-compliant → Skipped → Compliant; luego por cluster y servicio.
    all_audits.sort(key=lambda a: (_STATUS_ORDER.get(a.status, 9), a.cluster, a.service))
    return all_audits


def build_report(
    audit_results: list[ServiceAudit],
    *,
    timestamp: str,
    account_id: str,
) -> dict[str, Any]:
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.status == "Compliant")
    non_compliant = sum(1 for r in audit_results if r.status == "Non-compliant")
    skipped = sum(1 for r in audit_results if r.status == "Skipped")

    # Agregado por cluster (clave única = region::cluster para no mezclar
    # clusters homónimos en distintas regiones).
    by_cluster: dict[tuple[str, str], dict[str, Any]] = {}
    for r in audit_results:
        key = (r.region, r.cluster)
        bucket = by_cluster.setdefault(key, {
            "cluster": r.cluster,
            "region": r.region,
            "services": 0,
            "compliant": 0,
            "non_compliant": 0,
            "skipped": 0,
        })
        bucket["services"] += 1
        if r.status == "Compliant":
            bucket["compliant"] += 1
        elif r.status == "Non-compliant":
            bucket["non_compliant"] += 1
        else:
            bucket["skipped"] += 1

    clusters_summary = sorted(
        by_cluster.values(),
        key=lambda c: (-c["non_compliant"], c["cluster"]),
    )

    return {
        "script": "audit_ecs_fluentbit",
        "timestamp": timestamp,
        "account_id": account_id,
        "fluentbit_container_name": FLUENTBIT_CONTAINER_NAME,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": non_compliant,
            "skipped": skipped,
            "clusters": len(by_cluster),
        },
        "clusters": clusters_summary,
        "results": [r.to_dict() for r in audit_results],
    }
