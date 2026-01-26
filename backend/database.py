"""
Supabase database client and operations.
Replaces the in-memory session storage with Supabase persistence.
"""

import logging
from datetime import datetime
from typing import Any, Optional

from supabase import create_client, Client

from config import get_settings
from models import (
    Session,
    Mapping,
    GenerationJob,
    GeneratedReport,
    JobStatus,
    Presentation,
    Slide,
    SlideLayout,
    PendingEdit,
)

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Singleton Supabase client wrapper."""

    _instance: Optional["SupabaseClient"] = None
    _client: Optional[Client] = None

    def __new__(cls) -> "SupabaseClient":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def client(self) -> Client:
        if self._client is None:
            settings = get_settings()
            self._client = create_client(
                settings.supabase_url,
                settings.supabase_anon_key,
            )
        return self._client


def get_supabase() -> Client:
    """Get the Supabase client instance."""
    return SupabaseClient().client


# =============================================================================
# Sessions
# =============================================================================


def get_session(session_id: str) -> Optional[Session]:
    """Get a session by ID from Supabase."""
    try:
        supabase = get_supabase()
        # Use maybe_single() instead of single() to handle 0 results gracefully
        result = supabase.table("sessions").select("*").eq("id", session_id).maybe_single().execute()

        if not result.data:
            return None

        data = result.data
        return Session(
            id=data["id"],
            current_step=data.get("current_step", "select_engine"),
            fetched_projects_data=data.get("fetched_projects_data"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )
    except Exception as e:
        logger.error(f"Error getting session {session_id}: {e}")
        return None


def create_session(session_id: str) -> Session:
    """Create a new session in Supabase."""
    supabase = get_supabase()

    data = {
        "id": session_id,
        "current_step": "select_engine",
    }

    result = supabase.table("sessions").insert(data).execute()

    if result.data:
        return Session(
            id=result.data[0]["id"],
            current_step=result.data[0].get("current_step", "select_engine"),
        )

    raise Exception("Failed to create session")


def update_session(session_id: str, updates: dict[str, Any]) -> Optional[Session]:
    """Update a session in Supabase (creates if not exists)."""
    try:
        supabase = get_supabase()
        updates["id"] = session_id
        updates["updated_at"] = datetime.utcnow().isoformat()
        
        # Ensure current_step has a valid value for new sessions
        if "current_step" not in updates:
            updates.setdefault("current_step", "select_engine")

        # Use upsert to create session if it doesn't exist
        result = (
            supabase.table("sessions")
            .upsert(updates, on_conflict="id")
            .execute()
        )

        if result.data:
            return get_session(session_id)
        return None
    except Exception as e:
        logger.error(f"Error updating session {session_id}: {e}")
        return None


def get_or_create_session(session_id: str) -> Session:
    """Get existing session or create new one."""
    session = get_session(session_id)
    if session:
        return session
    return create_session(session_id)


# =============================================================================
# Mappings
# =============================================================================


def get_mapping_by_session(session_id: str) -> Optional[Mapping]:
    """Get mapping for a session."""
    try:
        supabase = get_supabase()
        result = (
            supabase.table("mappings")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not result.data:
            return None

        data = result.data[0]
        return Mapping(
            id=data["id"],
            session_id=data["session_id"],
            mapping_json=data.get("mapping_json"),
            template_path=data.get("template_path"),
            long_text_strategy=data.get("long_text_strategy"),
            created_at=data.get("created_at"),
        )
    except Exception as e:
        logger.error(f"Error getting mapping for session {session_id}: {e}")
        return None


def create_mapping(
    session_id: str,
    mapping_json: Optional[dict] = None,
    template_path: Optional[str] = None,
    long_text_strategy: Optional[str] = None,
) -> Mapping:
    """Create a new mapping for a session."""
    supabase = get_supabase()

    data = {
        "session_id": session_id,
        "mapping_json": mapping_json,
        "template_path": template_path,
        "long_text_strategy": long_text_strategy,
    }

    result = supabase.table("mappings").insert(data).execute()

    if result.data:
        d = result.data[0]
        return Mapping(
            id=d["id"],
            session_id=d["session_id"],
            mapping_json=d.get("mapping_json"),
            template_path=d.get("template_path"),
            long_text_strategy=d.get("long_text_strategy"),
            created_at=d.get("created_at"),
        )

    raise Exception("Failed to create mapping")


def update_mapping(mapping_id: str, updates: dict[str, Any]) -> Optional[Mapping]:
    """Update a mapping."""
    try:
        supabase = get_supabase()

        result = (
            supabase.table("mappings")
            .update(updates)
            .eq("id", mapping_id)
            .execute()
        )

        if result.data:
            d = result.data[0]
            return Mapping(
                id=d["id"],
                session_id=d["session_id"],
                mapping_json=d.get("mapping_json"),
                template_path=d.get("template_path"),
                long_text_strategy=d.get("long_text_strategy"),
                created_at=d.get("created_at"),
            )
        return None
    except Exception as e:
        logger.error(f"Error updating mapping {mapping_id}: {e}")
        return None


# =============================================================================
# Generation Jobs
# =============================================================================


def get_job(job_id: str) -> Optional[GenerationJob]:
    """Get a generation job by ID."""
    try:
        supabase = get_supabase()
        result = supabase.table("generation_jobs").select("*").eq("id", job_id).single().execute()

        if not result.data:
            return None

        data = result.data
        return GenerationJob(
            id=data["id"],
            session_id=data["session_id"],
            status=JobStatus(data.get("status", "pending")),
            engine=data.get("engine", "claude-pptx"),
            input_data=data.get("input_data"),
            result=data.get("result"),
            error=data.get("error"),
            prompt=data.get("prompt"),
            created_at=data.get("created_at"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
        )
    except Exception as e:
        logger.error(f"Error getting job {job_id}: {e}")
        return None


def create_job(session_id: str, input_data: dict[str, Any]) -> GenerationJob:
    """Create a new generation job."""
    supabase = get_supabase()

    data = {
        "session_id": session_id,
        "status": "pending",
        "engine": "claude-pptx",
        "input_data": input_data,
    }

    result = supabase.table("generation_jobs").insert(data).execute()

    if result.data:
        d = result.data[0]
        return GenerationJob(
            id=d["id"],
            session_id=d["session_id"],
            status=JobStatus(d.get("status", "pending")),
            engine=d.get("engine", "claude-pptx"),
            input_data=d.get("input_data"),
            created_at=d.get("created_at"),
        )

    raise Exception("Failed to create job")


def update_job(job_id: str, updates: dict[str, Any]) -> Optional[GenerationJob]:
    """Update a generation job."""
    try:
        supabase = get_supabase()

        result = (
            supabase.table("generation_jobs")
            .update(updates)
            .eq("id", job_id)
            .execute()
        )

        if result.data:
            return get_job(job_id)
        return None
    except Exception as e:
        logger.error(f"Error updating job {job_id}: {e}")
        return None


def mark_job_processing(job_id: str) -> Optional[GenerationJob]:
    """Mark a job as processing."""
    return update_job(job_id, {
        "status": "processing",
        "started_at": datetime.utcnow().isoformat(),
    })


def mark_job_completed(job_id: str, result: dict[str, Any]) -> Optional[GenerationJob]:
    """Mark a job as completed with result."""
    return update_job(job_id, {
        "status": "completed",
        "completed_at": datetime.utcnow().isoformat(),
        "result": result,
    })


def mark_job_failed(job_id: str, error: str) -> Optional[GenerationJob]:
    """Mark a job as failed with error."""
    return update_job(job_id, {
        "status": "failed",
        "completed_at": datetime.utcnow().isoformat(),
        "error": error,
    })


# =============================================================================
# Generated Reports
# =============================================================================


def get_reports_by_session(session_id: str) -> list[GeneratedReport]:
    """Get all reports for a session."""
    try:
        supabase = get_supabase()
        result = (
            supabase.table("generated_reports")
            .select("*")
            .eq("session_id", session_id)
            .order("iteration", desc=True)
            .execute()
        )

        reports = []
        for data in result.data or []:
            reports.append(GeneratedReport(
                id=data["id"],
                session_id=data["session_id"],
                engine=data.get("engine", "claude-pptx"),
                pptx_path=data.get("pptx_path", ""),
                iteration=data.get("iteration", 1),
                created_at=data.get("created_at"),
            ))
        return reports
    except Exception as e:
        logger.error(f"Error getting reports for session {session_id}: {e}")
        return []


def create_report(
    session_id: str,
    engine: str,
    pptx_path: str,
    iteration: int,
) -> GeneratedReport:
    """Create a new generated report record."""
    supabase = get_supabase()

    data = {
        "session_id": session_id,
        "engine": engine,
        "pptx_path": pptx_path,
        "iteration": iteration,
    }

    result = supabase.table("generated_reports").insert(data).execute()

    if result.data:
        d = result.data[0]
        return GeneratedReport(
            id=d["id"],
            session_id=d["session_id"],
            engine=d.get("engine", "claude-pptx"),
            pptx_path=d.get("pptx_path", ""),
            iteration=d.get("iteration", 1),
            created_at=d.get("created_at"),
        )

    raise Exception("Failed to create report")


def get_report_count(session_id: str) -> int:
    """Get the count of reports for a session."""
    try:
        supabase = get_supabase()
        result = (
            supabase.table("generated_reports")
            .select("id", count="exact")
            .eq("session_id", session_id)
            .execute()
        )
        return result.count or 0
    except Exception as e:
        logger.error(f"Error counting reports for session {session_id}: {e}")
        return 0


# =============================================================================
# Storage
# =============================================================================


def upload_file(
    bucket: str,
    path: str,
    file_data: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload a file to Supabase Storage."""
    supabase = get_supabase()

    result = supabase.storage.from_(bucket).upload(
        path,
        file_data,
        {"content-type": content_type},
    )

    return path


def get_public_url(bucket: str, path: str) -> str:
    """Get the public URL for a file in storage."""
    supabase = get_supabase()
    return supabase.storage.from_(bucket).get_public_url(path)


def download_file(bucket: str, path: str) -> bytes:
    """Download a file from Supabase Storage."""
    supabase = get_supabase()
    return supabase.storage.from_(bucket).download(path)
