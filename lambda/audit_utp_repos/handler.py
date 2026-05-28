"""
handler.py

AWS Lambda entry point for the UTPXpedition repository audit.

Environment variables (configure in Lambda console):
  GITHUB_SECRET_NAME   – Name of the AWS Secrets Manager secret that stores
                         the GitHub token. The secret must be a plain-text
                         string (the token itself) or a JSON object with a
                         "token" key.
  REPORTS_BUCKET       – S3 bucket name where reports are stored.
  AUDIT_MODE           – "audit" (default) or "apply".
  APPLY_CONFIRM        – Must be "true" when AUDIT_MODE=apply (safety gate).

S3 layout produced by this handler:
  reports/audit_utp_repos/<timestamp>.json   – individual report
  reports/index.json                          – updated manifest (all runs)

EventBridge rule example (cron, daily at 09:00 UTC):
  cron(0 9 * * ? *)
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

import boto3

from audit_core import (
    GitHubClient,
    build_report,
    run_apply,
    run_audit,
    validate_required_scopes,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# AWS helpers
# ---------------------------------------------------------------------------

def _get_github_token() -> str:
    """Fetch the GitHub token from AWS Secrets Manager."""
    secret_name = os.environ["GITHUB_SECRET_NAME"]
    client = boto3.client("secretsmanager")
    response = client.get_secret_value(SecretId=secret_name)

    secret = response.get("SecretString") or ""
    # Accept either a raw token string or {"token": "<value>"}
    try:
        parsed = json.loads(secret)
        if isinstance(parsed, dict):
            return parsed.get("token") or parsed.get("github_token") or secret
    except (ValueError, KeyError):
        pass
    return secret.strip()


def _get_mode() -> tuple[str, bool]:
    """Return (mode, apply_confirmed)."""
    mode = os.environ.get("AUDIT_MODE", "audit").lower()
    apply_confirmed = os.environ.get("APPLY_CONFIRM", "false").lower() == "true"
    return mode, apply_confirmed


def _s3_key_for_report(timestamp_str: str) -> str:
    """
    Convert ISO timestamp to an S3-safe key.
    '2026-05-13T09:00:00Z' → 'reports/audit_utp_repos/2026-05-13T09-00-00Z.json'
    """
    safe_ts = timestamp_str.replace(":", "-")
    return f"reports/audit_utp_repos/{safe_ts}.json"


def _load_index(s3_client: Any, bucket: str) -> dict:
    """Load existing manifest or create an empty one."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key="reports/index.json")
        return json.loads(response["Body"].read())
    except s3_client.exceptions.NoSuchKey:
        return {"reports": []}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load index.json (%s) — starting fresh.", exc)
        return {"reports": []}


def _save_to_s3(bucket: str, report: dict, timestamp_str: str) -> None:
    """Save the individual report and update the manifest index."""
    s3 = boto3.client("s3")
    report_key = _s3_key_for_report(timestamp_str)

    # 1) Save individual report
    s3.put_object(
        Bucket=bucket,
        Key=report_key,
        Body=json.dumps(report, ensure_ascii=False, indent=2).encode(),
        ContentType="application/json",
        CacheControl="no-cache",
    )
    logger.info("Report saved to s3://%s/%s", bucket, report_key)

    # 2) Update manifest
    index = _load_index(s3, bucket)
    summary_entry = {
        "script": report["script"],
        "timestamp": timestamp_str,
        "path": report_key,
        "mode": report.get("mode", "audit"),
        "summary": report["summary"],
    }
    # Prepend so the dashboard shows newest first
    index["reports"].insert(0, summary_entry)

    s3.put_object(
        Bucket=bucket,
        Key="reports/index.json",
        Body=json.dumps(index, ensure_ascii=False, indent=2).encode(),
        ContentType="application/json",
        CacheControl="no-cache",
    )
    logger.info("Manifest updated → %d total reports", len(index["reports"]))


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------

def lambda_handler(event: dict, context: object) -> dict:
    """
    Main Lambda entry point.
    Can be invoked by EventBridge (scheduled) or manually via test events.
    An optional test event payload can override the mode:
      {"audit_mode": "apply", "apply_confirm": true}
    """
    # Allow override from test event (useful for manual remediation runs)
    mode, apply_confirmed = _get_mode()
    if event.get("audit_mode"):
        mode = str(event["audit_mode"]).lower()
    if event.get("apply_confirm") is True:
        apply_confirmed = True

    bucket = os.environ["REPORTS_BUCKET"]
    timestamp_str = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    logger.info("Starting audit — mode=%s ts=%s bucket=%s", mode, timestamp_str, bucket)

    # Safety gate for apply mode
    if mode == "apply" and not apply_confirmed:
        msg = "AUDIT_MODE=apply requires APPLY_CONFIRM=true. No changes made."
        logger.warning(msg)
        return {"statusCode": 400, "body": msg}

    # Fetch token and build client
    token = _get_github_token()
    client = GitHubClient(token)
    validate_required_scopes(client, mode=mode)

    # Run audit
    audit_results = run_audit(client)

    # Optionally apply remediation
    apply_actions = None
    if mode == "apply":
        apply_actions = run_apply(client, audit_results)

    # Build report dict
    report = build_report(
        audit_results,
        mode=mode,
        timestamp=timestamp_str,
        apply_actions=apply_actions,
    )

    # Persist to S3
    _save_to_s3(bucket, report, timestamp_str)

    summary = report["summary"]
    logger.info(
        "Done — total=%d compliant=%d needs_action=%d skipped=%d",
        summary["total"],
        summary["compliant"],
        summary["needs_action"],
        summary["skipped"],
    )

    return {
        "statusCode": 200,
        "body": json.dumps({
            "timestamp": timestamp_str,
            "mode": mode,
            "summary": summary,
        }),
    }


# Allow local testing: python handler.py
if __name__ == "__main__":
    import sys

    # Quick local smoke-test (needs env vars set)
    result = lambda_handler({}, None)
    print(json.dumps(result, indent=2))
