"""
AirSaas API client for fetching project data.
"""

import asyncio
import logging
from typing import Any, Optional

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

# Cache for reference data
_reference_data_cache: dict[str, Any] = {
    "moods": None,
    "statuses": None,
    "risks": None,
    "cached_at": None,
}

CACHE_TTL_SECONDS = 300  # 5 minutes


async def fetch_with_rate_limit(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    retries: int = 3,
) -> httpx.Response:
    """Fetch with rate limit handling."""
    for attempt in range(retries):
        response = await client.get(url, headers=headers)

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After", str(attempt + 1))
            wait_seconds = int(retry_after)
            logger.warning(f"Rate limited, waiting {wait_seconds}s...")
            await asyncio.sleep(wait_seconds)
            continue

        return response

    raise Exception(f"Failed after {retries} retries due to rate limiting")


async def fetch_paginated(
    client: httpx.AsyncClient,
    base_url: str,
    headers: dict[str, str],
    max_pages: int = 0,
) -> list[Any]:
    """Fetch pages of a paginated endpoint.
    
    Args:
        max_pages: Maximum number of pages to fetch. 0 = no limit.
    """
    all_results = []
    url: Optional[str] = base_url
    page_count = 0

    if "page_size=" not in url:
        url += "&page_size=20" if "?" in url else "?page_size=20"

    while url:
        response = await fetch_with_rate_limit(client, url, headers)

        if not response.is_success:
            logger.error(f"Failed to fetch {url}: {response.status_code}")
            break

        data = response.json()
        all_results.extend(data.get("results", []))
        page_count += 1
        
        # Check page limit
        if max_pages > 0 and page_count >= max_pages:
            total_count = data.get("count", len(all_results))
            if total_count > len(all_results):
                logger.info(f"Reached max pages limit ({max_pages}). Fetched {len(all_results)}/{total_count} items.")
            break
            
        url = data.get("next")

    return all_results


async def fetch_reference_data(
    client: httpx.AsyncClient,
    base_url: str,
    headers: dict[str, str],
) -> dict[str, list]:
    """Fetch reference data (moods, statuses, risks) with caching."""
    import time

    now = time.time()

    # Check cache
    if (
        _reference_data_cache["cached_at"]
        and now - _reference_data_cache["cached_at"] < CACHE_TTL_SECONDS
        and _reference_data_cache["moods"]
    ):
        return {
            "moods": _reference_data_cache["moods"],
            "statuses": _reference_data_cache["statuses"],
            "risks": _reference_data_cache["risks"],
        }

    # Fetch in parallel
    moods_task = fetch_with_rate_limit(client, f"{base_url}/projects_moods/", headers)
    statuses_task = fetch_with_rate_limit(client, f"{base_url}/projects_statuses/", headers)
    risks_task = fetch_with_rate_limit(client, f"{base_url}/projects_risks/", headers)

    moods_res, statuses_res, risks_res = await asyncio.gather(
        moods_task, statuses_task, risks_task,
        return_exceptions=True,
    )

    moods = moods_res.json().get("results", []) if isinstance(moods_res, httpx.Response) and moods_res.is_success else []
    statuses = statuses_res.json().get("results", []) if isinstance(statuses_res, httpx.Response) and statuses_res.is_success else []
    risks = risks_res.json().get("results", []) if isinstance(risks_res, httpx.Response) and risks_res.is_success else []

    # Update cache
    _reference_data_cache.update({
        "moods": moods,
        "statuses": statuses,
        "risks": risks,
        "cached_at": now,
    })

    return {"moods": moods, "statuses": statuses, "risks": risks}


async def fetch_airsaas_project_data(project_id: str) -> dict[str, Any]:
    """
    Fetch all data for a project from AirSaas API.
    """
    settings = get_settings()
    api_key = settings.airsaas_api_key
    base_url = "https://api.airsaas.io/v1"

    if not api_key:
        raise Exception("Missing AIRSAAS_API_KEY")

    headers = {
        "Authorization": f"Api-Key {api_key}",
        "Content-Type": "application/json",
    }

    results: dict[str, Any] = {}

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Fetch reference data
        try:
            results["reference_data"] = await fetch_reference_data(client, base_url, headers)
        except Exception as e:
            logger.error(f"Failed to fetch reference data: {e}")
            results["reference_data"] = {"moods": [], "statuses": [], "risks": []}

        # 2. Fetch main project data
        try:
            project_url = f"{base_url}/projects/{project_id}/?expand=owner,program,goals,teams,requesting_team"
            response = await fetch_with_rate_limit(client, project_url, headers)
            if response.is_success:
                results["project"] = response.json()
            else:
                logger.error(f"Failed to fetch project: {response.status_code}")
                results["project"] = None
        except Exception as e:
            logger.error(f"Failed to fetch project: {e}")
            results["project"] = None

        # 3. Fetch simple endpoints
        simple_endpoints = [
            ("members", f"{base_url}/projects/{project_id}/members/"),
            ("efforts", f"{base_url}/projects/{project_id}/efforts/"),
            ("budget_lines", f"{base_url}/projects/{project_id}/budget_lines/"),
            ("budget_values", f"{base_url}/projects/{project_id}/budget_values/"),
        ]

        for key, url in simple_endpoints:
            try:
                response = await fetch_with_rate_limit(client, url, headers)
                if response.is_success:
                    data = response.json()
                    results[key] = data.get("results", data)
                else:
                    results[key] = None
            except Exception as e:
                logger.error(f"Failed to fetch {key}: {e}")
                results[key] = None

        # 4. Fetch paginated endpoints (with configurable page limit)
        max_pages = settings.airsaas_max_pages
        
        try:
            milestones_url = f"{base_url}/milestones/?project={project_id}&expand=owner,team,project"
            results["milestones"] = await fetch_paginated(client, milestones_url, headers, max_pages)
        except Exception as e:
            logger.error(f"Failed to fetch milestones: {e}")
            results["milestones"] = []

        try:
            decisions_url = f"{base_url}/decisions/?project={project_id}&expand=owner,decision_maker,project"
            results["decisions"] = await fetch_paginated(client, decisions_url, headers, max_pages)
        except Exception as e:
            logger.error(f"Failed to fetch decisions: {e}")
            results["decisions"] = []

        try:
            attention_url = f"{base_url}/attention_points/?project={project_id}&expand=owner,project"
            results["attention_points"] = await fetch_paginated(client, attention_url, headers, max_pages)
        except Exception as e:
            logger.error(f"Failed to fetch attention_points: {e}")
            results["attention_points"] = []

    return results


def compress_project_data(
    data: list[dict[str, Any]],
    max_text_length: int = 150,
) -> list[dict[str, Any]]:
    """
    Compress project data to reduce token usage.
    """
    fields_to_remove = [
        "created_at", "updated_at", "created_by", "modified_at", "modified_by",
        "uuid", "workspace", "workspace_id", "organization", "organization_id",
        "avatar", "avatar_url", "picture", "picture_url", "image", "image_url",
        "slug", "url", "external_id", "external_url", "api_url",
        "permissions", "can_edit", "can_delete", "can_view",
        "is_active", "is_archived", "is_deleted", "is_template",
        "sort_order", "position", "order", "rank",
        "id", "type", "locale", "timezone", "language",
        "metadata", "settings", "config", "options", "preferences",
        "tags", "labels", "categories", "classification",
        "history", "logs", "audit", "versions", "revisions",
        "attachments", "files", "documents", "media",
        "links", "references", "related", "associations",
        "custom_fields", "extra", "additional", "misc",
    ]

    long_text_fields = ["description", "content", "body", "notes", "comment", "summary", "details", "text"]

    def truncate_text(text: str, max_len: int) -> str:
        if len(text) <= max_len:
            return text
        return text[:max_len] + "..."

    def simplify_object(obj: Any, depth: int = 0) -> Any:
        if depth > 4:
            return "[nested]"

        if obj is None:
            return None

        if isinstance(obj, list):
            max_items = 20 if depth == 0 else 5
            limited = obj[:max_items]
            simplified = [simplify_object(item, depth + 1) for item in limited]
            if len(obj) > max_items:
                simplified.append(f"[+{len(obj) - max_items} more]")
            return simplified

        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                # Skip unnecessary fields
                if key in fields_to_remove:
                    continue
                if key.startswith("_") and key != "_metadata":
                    continue

                # Skip empty
                if isinstance(value, list) and len(value) == 0:
                    continue
                if isinstance(value, dict) and len(value) == 0:
                    continue

                # Truncate long text
                if isinstance(value, str) and key in long_text_fields:
                    result[key] = truncate_text(value, max_text_length)
                elif isinstance(value, str) and len(value) > 200:
                    result[key] = truncate_text(value, 200)
                else:
                    result[key] = simplify_object(value, depth + 1)

            return result

        return obj

    # Remove reference_data and simplify
    compressed = []
    for project in data:
        simplified = simplify_object(project)
        if isinstance(simplified, dict):
            simplified.pop("reference_data", None)
        compressed.append(simplified)

    return compressed


def estimate_tokens(data: Any) -> int:
    """Estimate token count (~4 chars per token)."""
    import json
    json_str = json.dumps(data)
    return len(json_str) // 4
