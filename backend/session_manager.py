"""
Session manager with in-memory presentation state.
Combines Supabase persistence with in-memory slide management.
"""

import logging
from contextvars import ContextVar
from typing import Any, Optional
import json

from models import (
    Session,
    Presentation,
    Slide,
    SlideLayout,
    PendingEdit,
)
import database as db

logger = logging.getLogger(__name__)

# Context variable for async-safe session storage
_current_session: ContextVar[Optional[Session]] = ContextVar("current_session", default=None)

# In-memory cache for presentation state (not stored in Supabase sessions table)
_presentation_cache: dict[str, dict[str, Any]] = {}


def get_current_session() -> Optional[Session]:
    """Get the current session from context."""
    return _current_session.get()


def set_current_session(session: Optional[Session]) -> None:
    """Set the current session in context."""
    _current_session.set(session)


def load_session(session_id: str) -> Session:
    """
    Load a session from Supabase and restore in-memory state.
    Creates a new session if it doesn't exist.
    """
    # Get or create session from Supabase
    session = db.get_or_create_session(session_id)

    # Restore in-memory presentation state from cache
    if session_id in _presentation_cache:
        cache = _presentation_cache[session_id]
        session.presentation = cache.get("presentation")
        session.pending_edits = cache.get("pending_edits", [])
        session.applied_edits = cache.get("applied_edits", [])

    set_current_session(session)
    return session


def save_session(session: Session) -> None:
    """
    Save session to Supabase and update in-memory cache.
    """
    # Update Supabase with persistent fields
    db.update_session(session.id, {
        "current_step": session.current_step,
        "fetched_projects_data": session.fetched_projects_data,
    })

    # Update in-memory cache for presentation state
    _presentation_cache[session.id] = {
        "presentation": session.presentation,
        "pending_edits": session.pending_edits,
        "applied_edits": session.applied_edits,
    }


def get_session_slides(session_id: str) -> list[dict[str, Any]]:
    """Get all slides for a session."""
    session = load_session(session_id)

    if not session.presentation:
        return []

    return [slide.to_dict() for slide in session.presentation.slides]


def get_session_presentation(session_id: str) -> Optional[dict[str, Any]]:
    """Get the full presentation state for a session."""
    session = load_session(session_id)

    if not session.presentation:
        return None

    return {
        "title": session.presentation.title,
        "slides": [s.to_dict() for s in session.presentation.slides],
        "theme": session.presentation.theme,
        "pending_edits": [e.to_dict() for e in session.pending_edits],
    }


def update_slide_html(session_id: str, slide_index: int, html: str) -> bool:
    """Update a specific slide's HTML directly (for frontend edits)."""
    session = load_session(session_id)

    if not session.presentation:
        return False

    if slide_index < 0 or slide_index >= len(session.presentation.slides):
        return False

    session.presentation.slides[slide_index].html = html
    save_session(session)
    return True


def clear_session_cache(session_id: str) -> None:
    """Clear the in-memory cache for a session."""
    if session_id in _presentation_cache:
        del _presentation_cache[session_id]


def export_presentation_json(session_id: str) -> Optional[str]:
    """Export presentation as JSON for the PPTX converter."""
    session = load_session(session_id)

    if not session.presentation:
        return None

    export_data = {
        "title": session.presentation.title,
        "theme": session.presentation.theme,
        "slides": [
            {
                "index": s.index,
                "html": s.html,
                "layout": s.layout.value,
                "notes": s.notes,
            }
            for s in session.presentation.slides
        ],
    }

    return json.dumps(export_data, indent=2)


class SessionManager:
    """
    Session manager class for compatibility with Jerry's agent pattern.
    Wraps the module-level functions.
    """

    def load_session(self, session_id: str) -> Session:
        return load_session(session_id)

    def save_session(self, session: Session) -> None:
        return save_session(session)

    def get_session_slides(self, session_id: str) -> list[dict[str, Any]]:
        return get_session_slides(session_id)

    def get_session_presentation(self, session_id: str) -> Optional[dict[str, Any]]:
        return get_session_presentation(session_id)

    def update_slide_html(self, session_id: str, slide_index: int, html: str) -> bool:
        return update_slide_html(session_id, slide_index, html)

    def clear_session_cache(self, session_id: str) -> None:
        return clear_session_cache(session_id)


# Global instance
session_manager = SessionManager()
