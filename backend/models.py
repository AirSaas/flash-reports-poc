"""
Data models for Flash Reports backend.
Based on the existing Supabase schema.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional
import uuid


class SlideLayout(Enum):
    """Slide layout types."""
    BLANK = "blank"
    TITLE = "title"
    CONTENT = "content"
    TWO_COLUMN = "two_column"
    TITLE_CONTENT = "title_content"


class JobStatus(Enum):
    """Generation job status."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class LongTextStrategy(Enum):
    """Strategy for handling long text in presentations."""
    SUMMARIZE = "summarize"
    ELLIPSIS = "ellipsis"
    OMIT = "omit"


@dataclass
class Slide:
    """Represents a single slide in a presentation."""
    index: int
    html: str
    layout: SlideLayout = SlideLayout.BLANK
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "html": self.html,
            "layout": self.layout.value,
            "notes": self.notes,
        }


@dataclass
class Presentation:
    """Represents a presentation with multiple slides."""
    title: str
    slides: list[Slide] = field(default_factory=list)
    theme: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "slides": [s.to_dict() for s in self.slides],
            "theme": self.theme,
        }


@dataclass
class PendingEdit:
    """Represents a pending edit operation on a presentation."""
    edit_id: str
    slide_index: int
    operation: str  # ADD, UPDATE, DELETE, REORDER
    params: dict[str, Any]
    preview: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "edit_id": self.edit_id,
            "slide_index": self.slide_index,
            "operation": self.operation,
            "params": self.params,
            "preview": self.preview,
        }


@dataclass
class Session:
    """
    Session state matching Supabase sessions table.
    """
    id: str
    current_step: str = "select_engine"
    fetched_projects_data: Optional[dict[str, Any]] = None
    template_analysis: Optional[dict[str, Any]] = None
    mapping_state: Optional[dict[str, Any]] = None
    anthropic_file_id: Optional[str] = None
    template_path: Optional[str] = None
    chat_history: Optional[list[dict[str, Any]]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # In-memory presentation state (not persisted to sessions table)
    presentation: Optional[Presentation] = None
    pending_edits: list[PendingEdit] = field(default_factory=list)
    applied_edits: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "current_step": self.current_step,
            "fetched_projects_data": self.fetched_projects_data,
            "presentation": self.presentation.to_dict() if self.presentation else None,
            "pending_edits": [e.to_dict() for e in self.pending_edits],
            "applied_edits": self.applied_edits,
        }


@dataclass
class Mapping:
    """
    Mapping configuration matching Supabase mappings table.
    """
    id: str
    session_id: str
    mapping_json: Optional[dict[str, Any]] = None
    template_path: Optional[str] = None
    long_text_strategy: Optional[str] = None
    created_at: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "mapping_json": self.mapping_json,
            "template_path": self.template_path,
            "long_text_strategy": self.long_text_strategy,
        }


@dataclass
class GenerationJob:
    """
    Generation job matching Supabase generation_jobs table.
    """
    id: str
    session_id: str
    status: JobStatus = JobStatus.PENDING
    engine: str = "claude-pptx"
    input_data: Optional[dict[str, Any]] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    prompt: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "status": self.status.value,
            "engine": self.engine,
            "input_data": self.input_data,
            "result": self.result,
            "error": self.error,
            "prompt": self.prompt,
        }


@dataclass
class GeneratedReport:
    """
    Generated report matching Supabase generated_reports table.
    """
    id: str
    session_id: str
    engine: str
    pptx_path: str
    iteration: int = 1
    created_at: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "engine": self.engine,
            "pptx_path": self.pptx_path,
            "iteration": self.iteration,
        }


# Request/Response models for API endpoints

@dataclass
class AgentStreamRequest:
    """Request body for /agent-stream endpoint."""
    session_id: str
    message: str
    projects_data: Optional[list[dict[str, Any]]] = None
    mapping_json: Optional[dict[str, Any]] = None
    template_path: Optional[str] = None


@dataclass
class GenerateRequest:
    """Request body for /generate endpoint."""
    session_id: str


@dataclass
class JobStatusRequest:
    """Request body for /job-status endpoint."""
    job_id: str
