"""
handler.py

Lambda entry point para auditar CloudWatch Log Groups.
Escribe el reporte al bucket central con prefijo por cuenta:

  reports/audit_cloudwatch_logs/<account_id>/<timestamp>.json
  reports/index.json (manifest común)
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3

from audit_core import build_report, run_audit

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _s3_key_for_report(timestamp_str: str, account_id: str) -> str:
    safe_ts = timestamp_str.replace(":", "-")
    return f"reports/audit_cloudwatch_logs/{account_id}/{safe_ts}.json"


def _load_index(s3_client: Any, bucket: str) -> dict:
    try:
        response = s3_client.get_object(Bucket=bucket, Key="reports/index.json")
        return json.loads(response["Body"].read())
    except s3_client.exceptions.NoSuchKey:
        return {"reports": []}
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudo cargar index.json (%s) — se inicia vacío.", exc)
        return {"reports": []}


def _save_to_s3(bucket: str, report: dict, timestamp_str: str, account_id: str) -> None:
    s3 = boto3.client("s3")
    report_key = _s3_key_for_report(timestamp_str, account_id)

    s3.put_object(
        Bucket=bucket,
        Key=report_key,
        Body=json.dumps(report, ensure_ascii=False, indent=2).encode(),
        ContentType="application/json",
        CacheControl="no-cache",
    )
    logger.info("Reporte guardado en s3://%s/%s", bucket, report_key)

    index = _load_index(s3, bucket)
    summary_entry = {
        "script": report["script"],
        "timestamp": timestamp_str,
        "path": report_key,
        "mode": "audit",
        "account_id": account_id,
        "summary": report["summary"],
    }
    index["reports"].insert(0, summary_entry)

    s3.put_object(
        Bucket=bucket,
        Key="reports/index.json",
        Body=json.dumps(index, ensure_ascii=False, indent=2).encode(),
        ContentType="application/json",
        CacheControl="no-cache",
    )
    logger.info("Manifest actualizado → %d reportes totales", len(index["reports"]))


def lambda_handler(event: dict, context: object) -> dict:
    bucket = os.environ["REPORTS_BUCKET"]
    timestamp_str = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    sts = boto3.client("sts")
    account_id = sts.get_caller_identity()["Account"]

    logger.info("Iniciando auditoría CloudWatch Logs — account=%s ts=%s", account_id, timestamp_str)

    audit_results = run_audit()
    report = build_report(audit_results, timestamp=timestamp_str, account_id=account_id)

    _save_to_s3(bucket, report, timestamp_str, account_id)

    summary = report["summary"]
    logger.info(
        "Listo — log_groups=%d incoming=%.2f GB cost=%.2f USD non_compliant=%d",
        summary["total"],
        summary["total_incoming_bytes"] / (1024 ** 3),
        summary["estimated_cost_usd"],
        summary["needs_action"],
    )

    return {
        "statusCode": 200,
        "body": json.dumps({
            "timestamp": timestamp_str,
            "summary": {
                "total": summary["total"],
                "incoming_gb": round(summary["total_incoming_bytes"] / (1024 ** 3), 2),
                "estimated_cost_usd": summary["estimated_cost_usd"],
                "needs_action": summary["needs_action"],
            },
        }),
    }


if __name__ == "__main__":
    print(json.dumps(lambda_handler({}, None), indent=2))
