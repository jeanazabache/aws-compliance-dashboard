"""
audit_core.py

Core audit logic for UTPXpedition repositories.
Adapted from audit_utp_repos.py to run inside AWS Lambda:
  - Token is injected as a parameter (not read from gh CLI).
  - Rich console is kept for CloudWatch Logs readability.
  - All public functions return Python objects (dict / list) for JSON serialization.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.github.com"
ORG = "UTPXpedition"
TEAM_SLUG = "team-operaciones"
ENV_NAME = "prd"
PER_PAGE = 100


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class RepoAudit:
    """Represents the audited state of a single repository."""

    name: str
    archived_or_disabled: bool
    has_master: bool
    has_prd: bool
    has_team_approval: bool

    @property
    def status(self) -> str:
        if self.archived_or_disabled:
            return "Skipped"
        if not self.has_master:
            return "Non-compliant"
        if self.has_master and self.has_prd and self.has_team_approval:
            return "Compliant"
        return "Partial"

    @property
    def needs_action(self) -> bool:
        return self.status in {"Partial", "Non-compliant"}

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "archived_or_disabled": self.archived_or_disabled,
            "has_master": self.has_master,
            "has_prd": self.has_prd,
            "has_team_approval": self.has_team_approval,
            "status": self.status,
        }


# ---------------------------------------------------------------------------
# GitHub HTTP client
# ---------------------------------------------------------------------------

class GitHubClient:
    """Basic GitHub API HTTP client with rate-limit retry."""

    def __init__(self, token: str) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "agn-audit-lambda",
            }
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> requests.Response:
        url = f"{BASE_URL}{path}"

        for attempt in range(2):
            response = self.session.request(
                method=method,
                url=url,
                params=params,
                json=payload,
                timeout=30,
            )

            if _is_rate_limited(response) and attempt == 0:
                wait = _compute_wait_seconds(response)
                logger.warning("Rate limit hit — waiting %ds before retry", wait)
                time.sleep(wait)
                continue

            return response

        return response  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_rate_limited(response: requests.Response) -> bool:
    if response.status_code == 429:
        return True
    if response.status_code != 403:
        return False
    remaining = response.headers.get("X-RateLimit-Remaining", "")
    return remaining == "0" or "rate limit" in response.text.lower()


def _compute_wait_seconds(response: requests.Response) -> int:
    retry_after = response.headers.get("Retry-After")
    if retry_after and retry_after.isdigit():
        return max(1, int(retry_after))
    reset_at = response.headers.get("X-RateLimit-Reset")
    if reset_at and reset_at.isdigit():
        return max(1, int(reset_at) - int(time.time()) + 1)
    return 5


def _safe_error(response: requests.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict) and isinstance(body.get("message"), str):
        return body["message"]
    return response.text.strip() or f"HTTP {response.status_code}"


# ---------------------------------------------------------------------------
# GitHub API operations
# ---------------------------------------------------------------------------

def validate_required_scopes(client: GitHubClient, *, mode: str = "audit") -> None:
    """Raise RuntimeError if token lacks required scopes for the selected mode."""
    response = client.request("GET", "/user")
    if response.status_code != 200:
        raise RuntimeError(f"Cannot validate token (HTTP {response.status_code}): {_safe_error(response)}")

    scopes_header = response.headers.get("X-OAuth-Scopes", "").strip()
    # Fine-grained PATs / GitHub App tokens may not expose classic OAuth scopes.
    # In that case, we continue and let endpoint-level permissions decide access.
    if not scopes_header:
        logger.warning(
            "Skipping strict scope validation: X-OAuth-Scopes header not present. "
            "If requests fail later, ensure token has the required repository/org permissions."
        )
        return

    scopes = {s.strip() for s in scopes_header.split(",") if s.strip()}
    required = {"repo"}
    if mode == "apply":
        required.add("admin:org")

    missing = sorted(required - scopes)
    if missing:
        raise RuntimeError(
            f"Token missing required scopes for mode '{mode}': {', '.join(missing)}"
        )


def list_org_repositories(client: GitHubClient) -> list[dict[str, Any]]:
    """Return all repos for ORG using pagination."""
    repos: list[dict[str, Any]] = []
    page = 1
    while True:
        response = client.request(
            "GET",
            f"/orgs/{ORG}/repos",
            params={"per_page": PER_PAGE, "page": page, "type": "all"},
        )
        if response.status_code != 200:
            raise RuntimeError(f"Cannot list repos (HTTP {response.status_code}): {_safe_error(response)}")
        page_data = response.json()
        repos.extend(page_data)
        if len(page_data) < PER_PAGE:
            break
        page += 1

    if not repos:
        raise RuntimeError(
            f"No repositories visible in org '{ORG}'. "
            "Verify the GitHub token has access to the organization repositories "
            "(classic PAT scopes repo/admin:org, or fine-grained token with repository access)."
        )

    return repos


def _branch_exists(client: GitHubClient, repo: str, branch: str) -> bool:
    response = client.request("GET", f"/repos/{ORG}/{repo}/branches/{branch}")
    if response.status_code == 200:
        return True
    if response.status_code == 404:
        return False
    logger.warning("%s: unexpected HTTP %d checking branch %s — assuming absent", repo, response.status_code, branch)
    return False


def _get_environment(client: GitHubClient, repo: str, env: str) -> tuple[bool, dict[str, Any] | None]:
    response = client.request("GET", f"/repos/{ORG}/{repo}/environments/{env}")
    if response.status_code == 200:
        return True, response.json()
    if response.status_code == 404:
        return False, None
    logger.warning("%s: unexpected HTTP %d checking env %s — assuming absent", repo, response.status_code, env)
    return False, None


def _env_has_required_team(env_payload: dict[str, Any]) -> bool:
    for rule in env_payload.get("protection_rules", []):
        if rule.get("type") != "required_reviewers":
            continue
        for reviewer in rule.get("reviewers", []):
            rtype = (reviewer.get("type") or "").lower()
            flat_slug = reviewer.get("slug")
            nested_slug = reviewer.get("reviewer", {}).get("slug")
            if rtype == "team" and TEAM_SLUG in (flat_slug, nested_slug):
                return True
    return False


def _extract_existing_reviewers(env_payload: dict[str, Any]) -> list[dict[str, Any]]:
    reviewers: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for rule in env_payload.get("protection_rules", []):
        if rule.get("type") != "required_reviewers":
            continue
        for entry in rule.get("reviewers", []):
            ctype = entry.get("type")
            nested = entry.get("reviewer", {})
            cid = nested.get("id") if isinstance(nested.get("id"), int) else entry.get("id")
            if not isinstance(cid, int) or ctype not in {"User", "Team"}:
                continue
            key = (ctype, cid)
            if key not in seen:
                seen.add(key)
                reviewers.append({"type": ctype, "id": cid})
    return reviewers


def _get_team_id(client: GitHubClient) -> int:
    response = client.request("GET", f"/orgs/{ORG}/teams/{TEAM_SLUG}")
    if response.status_code != 200:
        raise RuntimeError(f"Cannot resolve team {ORG}/{TEAM_SLUG}: {_safe_error(response)}")
    team_id = response.json().get("id")
    if not isinstance(team_id, int):
        raise RuntimeError(f"Team {TEAM_SLUG} returned no numeric id")
    return team_id


def _build_env_update_payload(env_payload: dict[str, Any], reviewers: list[dict[str, Any]]) -> dict[str, Any]:
    payload: dict[str, Any] = {"reviewers": reviewers}
    if "wait_timer" in env_payload:
        payload["wait_timer"] = int(env_payload.get("wait_timer") or 0)
    if "prevent_self_review" in env_payload:
        payload["prevent_self_review"] = bool(env_payload.get("prevent_self_review"))
    if "can_admins_bypass" in env_payload:
        payload["can_admins_bypass"] = bool(env_payload.get("can_admins_bypass"))
    dbp = env_payload.get("deployment_branch_policy")
    if isinstance(dbp, dict):
        payload["deployment_branch_policy"] = {
            "protected_branches": bool(dbp.get("protected_branches", False)),
            "custom_branch_policies": bool(dbp.get("custom_branch_policies", False)),
        }
    return payload


# ---------------------------------------------------------------------------
# Public API — called by handler.py
# ---------------------------------------------------------------------------

def run_audit(client: GitHubClient) -> list[RepoAudit]:
    """Audit all repos and return a list of RepoAudit objects."""
    repos = list_org_repositories(client)
    results: list[RepoAudit] = []

    for repo in repos:
        repo_name = repo.get("name", "")
        archived_or_disabled = bool(repo.get("archived") or repo.get("disabled"))

        if archived_or_disabled:
            results.append(RepoAudit(
                name=repo_name,
                archived_or_disabled=True,
                has_master=False,
                has_prd=False,
                has_team_approval=False,
            ))
            continue

        has_master = _branch_exists(client, repo_name, "master")
        has_prd, env_payload = _get_environment(client, repo_name, ENV_NAME)
        has_team_approval = _env_has_required_team(env_payload) if has_prd and env_payload else False

        results.append(RepoAudit(
            name=repo_name,
            archived_or_disabled=False,
            has_master=has_master,
            has_prd=has_prd,
            has_team_approval=has_team_approval,
        ))
        logger.info("%s → %s", repo_name, results[-1].status)

    return results


def run_apply(client: GitHubClient, audit_results: list[RepoAudit]) -> list[dict[str, Any]]:
    """
    Apply remediation to non-compliant repos.
    Returns a list of action dicts: {repo, action, success, detail}.
    """
    targets = [r for r in audit_results if r.needs_action and not r.archived_or_disabled]
    if not targets:
        logger.info("No repos need remediation.")
        return []

    team_id = _get_team_id(client)
    actions: list[dict[str, Any]] = []

    for repo in targets:
        # 1) Create prd environment if missing
        if not repo.has_prd:
            resp = client.request("PUT", f"/repos/{ORG}/{repo.name}/environments/{ENV_NAME}", payload={})
            success = resp.status_code in {200, 201}
            actions.append({
                "repo": repo.name,
                "action": f"create_environment_{ENV_NAME}",
                "success": success,
                "detail": "created" if success else _safe_error(resp),
            })
            logger.info("%s — create env %s: %s", repo.name, ENV_NAME, "OK" if success else "FAILED")
            if not success:
                continue

        # 2) Add required reviewer
        if not repo.has_team_approval:
            exists, env_payload = _get_environment(client, repo.name, ENV_NAME)
            if not exists or env_payload is None:
                actions.append({
                    "repo": repo.name,
                    "action": "add_required_reviewer",
                    "success": False,
                    "detail": f"could not fetch env {ENV_NAME}",
                })
                continue

            existing = _extract_existing_reviewers(env_payload)
            merged = {(r["type"], r["id"]): r for r in existing}
            merged[("Team", team_id)] = {"type": "Team", "id": team_id}
            payload = _build_env_update_payload(env_payload, list(merged.values()))

            resp = client.request("PUT", f"/repos/{ORG}/{repo.name}/environments/{ENV_NAME}", payload=payload)
            success = resp.status_code in {200, 201}
            actions.append({
                "repo": repo.name,
                "action": "add_required_reviewer",
                "success": success,
                "detail": f"added {ORG}/{TEAM_SLUG}" if success else _safe_error(resp),
            })
            logger.info("%s — add reviewer %s: %s", repo.name, TEAM_SLUG, "OK" if success else "FAILED")

    return actions


def build_report(
    audit_results: list[RepoAudit],
    *,
    mode: str,
    timestamp: str,
    apply_actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Assemble the full JSON report dict."""
    total = len(audit_results)
    compliant = sum(1 for r in audit_results if r.status == "Compliant")
    needs_action = sum(1 for r in audit_results if r.needs_action)
    skipped = sum(1 for r in audit_results if r.status == "Skipped")

    report: dict[str, Any] = {
        "script": "audit_utp_repos",
        "timestamp": timestamp,
        "org": ORG,
        "mode": mode,
        "summary": {
            "total": total,
            "compliant": compliant,
            "needs_action": needs_action,
            "skipped": skipped,
        },
        "results": [r.to_dict() for r in audit_results],
    }

    if apply_actions is not None:
        report["apply_actions"] = apply_actions

    return report
