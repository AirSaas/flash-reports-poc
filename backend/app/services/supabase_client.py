"""
Supabase Client Service

Handles all database operations with Supabase.
"""

from supabase import create_client, Client
from typing import Dict, Any, Optional, List
import httpx

from app.config import SUPABASE_URL, SUPABASE_KEY


def get_supabase_client() -> Client:
    """Get Supabase client instance."""
    return create_client(SUPABASE_URL, SUPABASE_KEY)


async def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Get session data from Supabase.
    """
    supabase = get_supabase_client()
    result = supabase.table('sessions').select('*').eq('id', session_id).single().execute()
    return result.data if result.data else None


async def get_mapping(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Get mapping configuration for a session.
    """
    supabase = get_supabase_client()
    result = supabase.table('mappings').select('*').eq('session_id', session_id).single().execute()
    return result.data if result.data else None


async def get_fetched_projects(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Get fetched projects data from session.
    """
    session = await get_session(session_id)
    if session and session.get('fetched_projects_data'):
        return session['fetched_projects_data']
    return None


async def download_template(template_path: str) -> bytes:
    """
    Download template file from Supabase Storage.

    Args:
        template_path: Path in the storage bucket (e.g., "session-id/template.pptx")

    Returns:
        File content as bytes
    """
    # Construct the storage URL
    storage_url = f"{SUPABASE_URL}/storage/v1/object/public/templates/{template_path}"

    async with httpx.AsyncClient() as client:
        response = await client.get(storage_url)
        response.raise_for_status()
        return response.content


async def upload_generated_html(session_id: str, html_content: str, filename: str = "report.html") -> str:
    """
    Upload generated HTML to Supabase Storage.

    Returns:
        Public URL of the uploaded file
    """
    supabase = get_supabase_client()

    file_path = f"{session_id}/{filename}"

    # Upload to storage (use 'outputs' bucket)
    result = supabase.storage.from_('outputs').upload(
        file_path,
        html_content.encode('utf-8'),
        {"content-type": "text/html"}
    )

    # Get public URL
    public_url = supabase.storage.from_('outputs').get_public_url(file_path)

    return public_url


async def upload_pdf(session_id: str, pdf_bytes: bytes, filename: str = "template.pdf") -> str:
    """
    Upload PDF file to Supabase Storage.

    Returns:
        Public URL of the uploaded file
    """
    supabase = get_supabase_client()

    file_path = f"{session_id}/{filename}"

    # Upload to storage (use 'outputs' bucket)
    result = supabase.storage.from_('outputs').upload(
        file_path,
        pdf_bytes,
        {"content-type": "application/pdf"}
    )

    # Get public URL
    public_url = supabase.storage.from_('outputs').get_public_url(file_path)

    return public_url


async def create_generation_job(
    session_id: str,
    engine: str = "claude-html",
    input_data: Optional[Dict[str, Any]] = None
) -> str:
    """
    Create a new generation job in the database.

    Returns:
        Job ID
    """
    supabase = get_supabase_client()

    job_data = {
        "session_id": session_id,
        "status": "pending",
        "engine": engine,
        "input_data": input_data or {}
    }

    result = supabase.table('generation_jobs').insert(job_data).execute()

    if result.data:
        return result.data[0]['id']

    raise RuntimeError("Failed to create generation job")


async def update_job_status(
    job_id: str,
    status: str,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None
) -> None:
    """
    Update a generation job's status.
    """
    supabase = get_supabase_client()

    update_data = {"status": status}

    if status == "processing":
        update_data["started_at"] = "now()"
    elif status in ("completed", "failed"):
        update_data["completed_at"] = "now()"

    if result:
        update_data["result"] = result

    if error:
        update_data["error"] = error

    supabase.table('generation_jobs').update(update_data).eq('id', job_id).execute()


async def save_generated_report(
    session_id: str,
    html_path: str,
    engine: str = "claude-html"
) -> str:
    """
    Save a reference to a generated report.

    Returns:
        Report ID
    """
    supabase = get_supabase_client()

    # Get current iteration count
    count_result = supabase.table('generated_reports').select('id', count='exact').eq('session_id', session_id).execute()
    iteration = (count_result.count or 0) + 1

    report_data = {
        "session_id": session_id,
        "engine": engine,
        "pptx_path": html_path,  # Using pptx_path field for HTML path too
        "iteration": iteration
    }

    result = supabase.table('generated_reports').insert(report_data).execute()

    if result.data:
        return result.data[0]['id']

    raise RuntimeError("Failed to save generated report")


async def get_job_status(job_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the current status of a generation job.
    """
    supabase = get_supabase_client()
    result = supabase.table('generation_jobs').select('*').eq('id', job_id).single().execute()
    return result.data if result.data else None
