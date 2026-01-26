"""
Flash Reports Backend - FastAPI Application
Compatible with the existing frontend Edge Functions API.

All endpoints match the Supabase Edge Functions paths:
- POST /functions/v1/get-session
- POST /functions/v1/upload-template
- POST /functions/v1/analyze-template
- POST /functions/v1/fetch-projects
- POST /functions/v1/mapping-question
- POST /functions/v1/chat
- POST /functions/v1/generate-claude-pptx
- POST /functions/v1/process-pptx-job
- POST /functions/v1/check-job-status
- POST /functions/v1/copy-mapping
- POST /functions/v1/copy-fetched-data
"""

import asyncio
import json
import logging
import os
import subprocess
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import get_settings
import database as db
from airsaas import fetch_airsaas_project_data, compress_project_data
from template_analyzer import analyze_template_with_claude
from mapping_engine import (
    get_next_mapping_question,
    generate_batch_suggestions,
    save_batch_mappings,
    AVAILABLE_AIRSAAS_FIELDS,
)
from chat_handler import handle_chat_message, handle_chat_stream

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# =============================================================================
# Lifespan management
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Starting Flash Reports Backend...")
    yield
    logger.info("Shutting down Flash Reports Backend...")


# =============================================================================
# FastAPI App
# =============================================================================

app = FastAPI(
    title="Flash Reports API",
    description="Backend API compatible with Flash Reports frontend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Helper to get session ID from header
# =============================================================================

def get_session_id(x_session_id: Optional[str] = Header(None, alias="x-session-id")) -> str:
    """Extract session ID from x-session-id header."""
    if not x_session_id:
        raise HTTPException(status_code=400, detail="x-session-id header is required")
    return x_session_id


# =============================================================================
# Health Check
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# =============================================================================
# GET-SESSION Endpoint
# =============================================================================

class GetSessionRequest(BaseModel):
    action: Optional[str] = None
    long_text_strategy: Optional[str] = None


@app.post("/functions/v1/get-session")
async def get_session(
    request: Request,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Get session state or perform session actions.

    Actions:
    - None: Get session and mapping data
    - "update_strategy": Update long text strategy
    - "get_fetched_data_info": Get info about fetched project data
    """
    try:
        body = {}
        try:
            body = await request.json()
        except:
            pass

        action = body.get("action")

        # Handle update_strategy action
        if action == "update_strategy":
            long_text_strategy = body.get("long_text_strategy")
            if long_text_strategy:
                mapping = db.get_mapping_by_session(x_session_id)
                if mapping:
                    db.update_mapping(mapping.id, {"long_text_strategy": long_text_strategy})
                db.update_session(x_session_id, {"current_step": "generating"})
            return {"success": True}

        # Handle get_fetched_data_info action
        if action == "get_fetched_data_info":
            session = db.get_session(x_session_id)
            if not session or not session.fetched_projects_data:
                return {"projectCount": 0, "fetchedAt": None}

            fetched_data = session.fetched_projects_data
            return {
                "projectCount": fetched_data.get("successful_count") or fetched_data.get("project_count", 0),
                "fetchedAt": fetched_data.get("fetched_at"),
            }

        # Default: Get session and mapping data
        session = db.get_session(x_session_id)
        mapping = db.get_mapping_by_session(x_session_id)

        return {
            "session": {
                "id": session.id if session else x_session_id,
                "current_step": session.current_step if session else "select_engine",
                "chat_history": [],
                "created_at": session.created_at if session else None,
                "updated_at": session.updated_at if session else None,
            } if session else None,
            "mapping": {
                "template_path": mapping.template_path,
                "mapping_json": mapping.mapping_json,
                "long_text_strategy": mapping.long_text_strategy,
            } if mapping else None,
        }
    except Exception as e:
        logger.error(f"Get session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# UPLOAD-TEMPLATE Endpoint
# =============================================================================

class UploadTemplateRequest(BaseModel):
    templatePath: str


@app.post("/functions/v1/upload-template")
async def upload_template(
    request: UploadTemplateRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Register an uploaded template for a session.
    The actual file upload happens directly to Supabase Storage from the frontend.
    """
    try:
        template_path = request.templatePath

        if not template_path:
            raise HTTPException(status_code=400, detail="Template path is required")

        # Ensure session exists
        session = db.get_or_create_session(x_session_id)

        # Create or update mapping with template path
        existing_mapping = db.get_mapping_by_session(x_session_id)
        if existing_mapping:
            db.update_mapping(existing_mapping.id, {"template_path": template_path})
        else:
            db.create_mapping(
                session_id=x_session_id,
                template_path=template_path,
            )

        return {
            "success": True,
            "templatePath": template_path,
        }
    except Exception as e:
        logger.error(f"Upload template error: {e}")
        return {
            "success": False,
            "error": str(e),
        }


# =============================================================================
# ANALYZE-TEMPLATE Endpoint
# =============================================================================

class AnalyzeTemplateRequest(BaseModel):
    templatePath: str


@app.post("/functions/v1/analyze-template")
async def analyze_template(
    request: AnalyzeTemplateRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Analyze a PPTX template using Claude to identify fields.
    """
    try:
        template_path = request.templatePath

        if not template_path:
            raise HTTPException(status_code=400, detail="templatePath is required")

        # Analyze template with Claude
        analysis, anthropic_file_id = await analyze_template_with_claude(
            template_path=template_path,
            session_id=x_session_id,
        )

        # Save analysis to session
        db.update_session(x_session_id, {
            "template_analysis": analysis,
            "current_step": "mapping",
        })

        return {
            "success": True,
            "analysis": analysis,
            "anthropicFileId": anthropic_file_id,
        }
    except Exception as e:
        logger.error(f"Analyze template error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# FETCH-PROJECTS Endpoint
# =============================================================================

class ProjectItem(BaseModel):
    id: str
    name: str
    short_id: Optional[str] = None


class ProjectsConfig(BaseModel):
    workspace: str
    projects: list[ProjectItem]


class FetchProjectsRequest(BaseModel):
    projectsConfig: ProjectsConfig


@app.post("/functions/v1/fetch-projects")
async def fetch_projects(
    request: FetchProjectsRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Fetch project data from AirSaas API.
    """
    try:
        projects_config = request.projectsConfig

        if not projects_config.projects:
            raise HTTPException(status_code=400, detail="Projects list is required")

        logger.info(f"Fetching data for {len(projects_config.projects)} projects...")

        all_projects_data = []
        errors = []

        for i, project in enumerate(projects_config.projects):
            logger.info(f"[{i+1}/{len(projects_config.projects)}] Fetching: {project.name}")

            try:
                project_data = await fetch_airsaas_project_data(project.id)
                all_projects_data.append({
                    **project_data,
                    "_metadata": {
                        "id": project.id,
                        "short_id": project.short_id,
                        "name": project.name,
                    },
                })
            except Exception as e:
                logger.error(f"Failed to fetch project {project.id}: {e}")
                errors.append({"projectId": project.id, "error": str(e)})
                all_projects_data.append({
                    "_metadata": {
                        "id": project.id,
                        "short_id": project.short_id,
                        "name": project.name,
                        "error": str(e),
                    },
                })

        # Compress data
        compressed_data = compress_project_data(all_projects_data)

        # Save to session
        fetched_data = {
            "fetched_at": datetime.utcnow().isoformat(),
            "workspace": projects_config.workspace,
            "project_count": len(projects_config.projects),
            "successful_count": len(projects_config.projects) - len(errors),
            "projects": compressed_data,
        }

        db.update_session(x_session_id, {"fetched_projects_data": fetched_data})

        return {
            "success": True,
            "projectCount": len(projects_config.projects),
            "successfulCount": len(projects_config.projects) - len(errors),
            "errors": errors if errors else None,
        }
    except Exception as e:
        logger.error(f"Fetch projects error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# MAPPING-QUESTION Endpoint
# =============================================================================

class MappingQuestionRequest(BaseModel):
    action: str  # "next" or "answer"
    answer: Optional[str] = None


@app.post("/functions/v1/mapping-question")
async def mapping_question(
    request: MappingQuestionRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Interactive Q&A for field mapping.
    """
    try:
        result = await get_next_mapping_question(
            session_id=x_session_id,
            action=request.action,
            answer=request.answer,
        )
        return result
    except Exception as e:
        logger.error(f"Mapping question error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# MAPPING-BATCH Endpoints (New Batch UX)
# =============================================================================

@app.post("/functions/v1/mapping-batch")
async def mapping_batch(
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Get all template fields with AI-suggested mappings in one call.
    Returns all fields with pre-filled suggestions for batch editing.
    """
    try:
        result = await generate_batch_suggestions(session_id=x_session_id)
        return result
    except Exception as e:
        logger.error(f"Mapping batch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BatchMappingSubmitRequest(BaseModel):
    mappings: dict[str, str]  # { field_id: source_id }


@app.post("/functions/v1/mapping-batch-submit")
async def mapping_batch_submit(
    request: BatchMappingSubmitRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Save all field mappings at once.
    """
    try:
        result = await save_batch_mappings(
            session_id=x_session_id,
            mappings=request.mappings,
        )
        return result
    except Exception as e:
        logger.error(f"Mapping batch submit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# CHAT Endpoint (SSE Streaming)
# =============================================================================

class ChatRequest(BaseModel):
    message: str
    stream: Optional[bool] = False


@app.post("/functions/v1/chat")
async def chat(
    request: ChatRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Chat endpoint for conversational mapping.
    Supports both streaming (SSE) and non-streaming responses.
    """
    try:
        if request.stream:
            return StreamingResponse(
                handle_chat_stream(x_session_id, request.message),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        else:
            result = await handle_chat_message(x_session_id, request.message)
            return result
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# GENERATE-CLAUDE-PPTX Endpoint
# =============================================================================

@app.post("/functions/v1/generate-claude-pptx")
async def generate_claude_pptx(
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Create a PPTX generation job.
    Returns jobId immediately for polling.
    """
    try:
        logger.info(f"Creating generation job for session: {x_session_id}")

        # Get session with fetched data
        session = db.get_session(x_session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Get mapping
        mapping = db.get_mapping_by_session(x_session_id)
        if not mapping:
            raise HTTPException(
                status_code=400,
                detail="No mapping found. Please complete the mapping step first.",
            )

        # Get fetched data
        fetched_data = []
        if session.fetched_projects_data:
            fetched_data = session.fetched_projects_data.get("projects", [])

        if not fetched_data:
            raise HTTPException(
                status_code=400,
                detail="No project data available. Please fetch AirSaas data first.",
            )

        logger.info(f"Found {len(fetched_data)} projects, creating job...")

        # Create job (include template_path for generation)
        job = db.create_job(
            session_id=x_session_id,
            input_data={
                "mappingJson": mapping.mapping_json,
                "longTextStrategy": mapping.long_text_strategy,
                "fetchedData": fetched_data,
                "templatePath": mapping.template_path,  # Include template for PPTX generation
            },
        )

        logger.info(f"Created job: {job.id}")

        return {
            "success": True,
            "jobId": job.id,
            "message": "Generation job created. Poll check-job-status for updates.",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Generate PPTX error: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# PROCESS-PPTX-JOB Endpoint
# =============================================================================

class ProcessJobRequest(BaseModel):
    jobId: str


@app.post("/functions/v1/process-pptx-job")
async def process_pptx_job(
    request: ProcessJobRequest,
    background_tasks: BackgroundTasks,
):
    """
    Process a PPTX generation job.
    Fire-and-forget - processing happens in background.
    """
    try:
        job = db.get_job(request.jobId)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.status.value != "pending":
            return {"success": True, "message": f"Job already {job.status.value}"}

        # Mark as processing
        db.mark_job_processing(request.jobId)

        # Run in background
        background_tasks.add_task(process_job_background, request.jobId)

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Process job error: {e}")
        return {"success": False, "error": str(e)}


async def process_job_background(job_id: str):
    """Background task to process a generation job using Claude PPTX Skill."""
    from pptx_generator import generate_pptx_with_claude

    try:
        job = db.get_job(job_id)
        if not job:
            return

        logger.info(f"[JOB {job_id}] Starting processing...")

        input_data = job.input_data or {}

        # Generate PPTX using Claude (with template if available)
        result = await generate_pptx_with_claude(
            job_id=job_id,
            session_id=job.session_id,
            mapping_json=input_data.get("mappingJson", {}),
            long_text_strategy=input_data.get("longTextStrategy"),
            fetched_data=input_data.get("fetchedData", []),
            template_path=input_data.get("templatePath"),  # Pass template to use as base
        )

        # Mark completed
        db.mark_job_completed(job_id, result)
        db.update_session(job.session_id, {"current_step": "evaluating"})

        logger.info(f"[JOB {job_id}] Completed successfully!")

    except Exception as e:
        logger.error(f"[JOB {job_id}] Failed: {e}")
        db.mark_job_failed(job_id, str(e))


# =============================================================================
# CHECK-JOB-STATUS Endpoint
# =============================================================================

class JobStatusRequest(BaseModel):
    jobId: str


@app.post("/functions/v1/check-job-status")
async def check_job_status(
    request: JobStatusRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Check the status of a generation job.
    """
    try:
        job = db.get_job(request.jobId)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Security: only allow checking own jobs
        if job.session_id != x_session_id:
            raise HTTPException(status_code=403, detail="Not authorized to view this job")

        return {
            "success": True,
            "job": {
                "id": job.id,
                "jobType": "generation",
                "status": job.status.value,
                "result": job.result,
                "error": job.error,
                "prompt": job.prompt,
                "createdAt": job.created_at,
                "startedAt": job.started_at,
                "completedAt": job.completed_at,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Check job status error: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# COPY-MAPPING Endpoint
# =============================================================================

class CopyMappingRequest(BaseModel):
    sourceMappingId: str


@app.post("/functions/v1/copy-mapping")
async def copy_mapping(
    request: CopyMappingRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Copy mapping and project data from a source session.
    """
    try:
        source_mapping_id = request.sourceMappingId

        # Get source mapping
        supabase = db.get_supabase()
        result = supabase.table("mappings").select("*").eq("id", source_mapping_id).single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Source mapping not found")

        source_mapping = result.data
        source_session_id = source_mapping["session_id"]

        logger.info(f"Copying mapping from session {source_session_id} to {x_session_id}")

        # Get source session's fetched data
        source_session = db.get_session(source_session_id)
        has_fetched_data = bool(source_session and source_session.fetched_projects_data)

        # Ensure current session exists
        db.get_or_create_session(x_session_id)

        # Copy fetched data if available
        if has_fetched_data:
            db.update_session(x_session_id, {
                "fetched_projects_data": source_session.fetched_projects_data,
                "current_step": "long_text_options",
            })

        # Copy or update mapping
        existing_mapping = db.get_mapping_by_session(x_session_id)
        if existing_mapping:
            db.update_mapping(existing_mapping.id, {
                "mapping_json": source_mapping.get("mapping_json"),
                "template_path": source_mapping.get("template_path"),
                "long_text_strategy": source_mapping.get("long_text_strategy"),
            })
        else:
            db.create_mapping(
                session_id=x_session_id,
                mapping_json=source_mapping.get("mapping_json"),
                template_path=source_mapping.get("template_path"),
                long_text_strategy=source_mapping.get("long_text_strategy"),
            )

        return {
            "success": True,
            "message": "Mapping copied successfully",
            "hasFetchedData": has_fetched_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Copy mapping error: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# COPY-FETCHED-DATA Endpoint
# =============================================================================

class CopyFetchedDataRequest(BaseModel):
    sourceSessionId: str


@app.post("/functions/v1/copy-fetched-data")
async def copy_fetched_data(
    request: CopyFetchedDataRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Copy fetched project data from a source session.
    """
    try:
        source_session_id = request.sourceSessionId

        # Get source session
        source_session = db.get_session(source_session_id)
        if not source_session:
            raise HTTPException(status_code=404, detail="Source session not found")

        if not source_session.fetched_projects_data:
            raise HTTPException(status_code=400, detail="Source session has no fetched data")

        logger.info(f"Copying fetched data from {source_session_id} to {x_session_id}")

        # Ensure current session exists
        db.get_or_create_session(x_session_id)

        # Copy fetched data
        db.update_session(x_session_id, {
            "fetched_projects_data": source_session.fetched_projects_data,
        })

        fetched_data = source_session.fetched_projects_data

        return {
            "success": True,
            "message": "Fetched data copied successfully",
            "projectCount": fetched_data.get("successful_count") or fetched_data.get("project_count", 0),
            "fetchedAt": fetched_data.get("fetched_at"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Copy fetched data error: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# CREATE-EVAL-JOB Endpoint
# =============================================================================

class CreateEvalJobRequest(BaseModel):
    reportId: str


@app.post("/functions/v1/create-eval-job")
async def create_eval_job(
    request: CreateEvalJobRequest,
    x_session_id: str = Header(..., alias="x-session-id"),
):
    """
    Create an evaluation job for a generated report.
    Returns jobId immediately for polling.
    """
    try:
        supabase = db.get_supabase()
        report_id = request.reportId

        logger.info(f"Creating evaluation job for report: {report_id}")

        # Verify report exists and belongs to session
        result = supabase.table("generated_reports").select("*").eq("id", report_id).eq("session_id", x_session_id).single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Report not found or does not belong to this session")

        report = result.data
        if not report.get("pptx_path"):
            raise HTTPException(status_code=400, detail="Report has no PPTX file to evaluate")

        # Get project count from session
        session = db.get_session(x_session_id)
        project_count = 0
        if session and session.fetched_projects_data:
            projects = session.fetched_projects_data.get("projects", [])
            project_count = len(projects)

        # Create evaluation job
        job_data = {
            "session_id": x_session_id,
            "job_type": "evaluation",
            "status": "pending",
            "engine": "claude-pptx",
            "input_data": {
                "reportId": report_id,
                "pptxPath": report["pptx_path"],
                "projectCount": project_count,
            },
        }

        job_result = supabase.table("generation_jobs").insert(job_data).execute()

        if not job_result.data:
            raise Exception("Failed to create evaluation job")

        job_id = job_result.data[0]["id"]
        logger.info(f"Created evaluation job: {job_id}")

        return {
            "success": True,
            "jobId": job_id,
            "message": "Evaluation job created. Trigger process-eval-job and poll check-job-status.",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create eval job error: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# PROCESS-EVAL-JOB Endpoint
# =============================================================================

class ProcessEvalJobRequest(BaseModel):
    jobId: str


@app.post("/functions/v1/process-eval-job")
async def process_eval_job(
    request: ProcessEvalJobRequest,
    background_tasks: BackgroundTasks,
):
    """
    Process an evaluation job.
    Fire-and-forget - processing happens in background.
    """
    try:
        supabase = db.get_supabase()

        # Get job
        result = supabase.table("generation_jobs").select("*").eq("id", request.jobId).eq("job_type", "evaluation").single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Evaluation job not found")

        job = result.data

        if job["status"] == "completed":
            return {"success": True, "alreadyCompleted": True}

        if job["status"] == "processing":
            return {"success": True, "alreadyProcessing": True}

        # Mark as processing
        supabase.table("generation_jobs").update({
            "status": "processing",
            "started_at": datetime.utcnow().isoformat(),
        }).eq("id", request.jobId).execute()

        # Run in background
        background_tasks.add_task(process_eval_job_background, request.jobId)

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Process eval job error: {e}")
        return {"success": False, "error": str(e)}


async def process_eval_job_background(job_id: str):
    """Background task to process an evaluation job using Claude PPTX Skill."""
    from report_evaluator import evaluate_report_with_claude

    supabase = db.get_supabase()

    try:
        # Get job
        result = supabase.table("generation_jobs").select("*").eq("id", job_id).single().execute()
        if not result.data:
            return

        job = result.data
        input_data = job.get("input_data", {})

        logger.info(f"[EVAL JOB {job_id}] Starting evaluation...")

        # Evaluate report
        evaluation = await evaluate_report_with_claude(
            job_id=job_id,
            pptx_path=input_data.get("pptxPath"),
            project_count=input_data.get("projectCount", 0),
        )

        # Determine recommendation
        should_regenerate = evaluation["score"] < 65 and evaluation.get("recommendation") == "regenerate"

        result_data = {
            "evaluation": evaluation,
            "shouldRegenerate": should_regenerate,
        }

        # Update report with score
        report_id = input_data.get("reportId")
        if report_id:
            supabase.table("generated_reports").update({
                "eval_score": evaluation["score"],
            }).eq("id", report_id).execute()

        # Update session step
        supabase.table("sessions").update({
            "current_step": "done",
        }).eq("id", job["session_id"]).execute()

        # Mark job completed
        supabase.table("generation_jobs").update({
            "status": "completed",
            "result": result_data,
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", job_id).execute()

        logger.info(f"[EVAL JOB {job_id}] Completed! Score: {evaluation['score']}")

    except Exception as e:
        logger.error(f"[EVAL JOB {job_id}] Failed: {e}")
        supabase.table("generation_jobs").update({
            "status": "failed",
            "error": str(e),
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", job_id).execute()


# =============================================================================
# Main entry point
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
