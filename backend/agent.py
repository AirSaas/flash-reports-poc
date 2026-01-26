"""
Claude Agent SDK integration for Flash Reports.
Based on Jerry's presentation_app agent.py.

Provides 10 tools for presentation manipulation:
1. create_presentation - Initialize a new presentation
2. add_slide - Add a slide with HTML content
3. update_slide - Update existing slide HTML
4. delete_slide - Remove a slide
5. reorder_slides - Move slides
6. list_slides - List all slides with previews
7. get_slide - Get full slide details
8. set_theme - Apply theme styling
9. get_pending_edits - Show uncommitted changes
10. commit_edits - Apply all pending edits
"""

import asyncio
import json
import logging
import re
import uuid
from contextvars import ContextVar
from typing import Any, AsyncGenerator, Optional

import anthropic

from config import get_settings
from models import (
    Presentation,
    Slide,
    SlideLayout,
    PendingEdit,
    Session,
)
from session_manager import (
    get_current_session,
    set_current_session,
    load_session,
    save_session,
    session_manager,
)

logger = logging.getLogger(__name__)

# =============================================================================
# Tool decorator (simplified version without Claude Agent SDK dependency)
# =============================================================================

_registered_tools: dict[str, dict[str, Any]] = {}


def tool(name: str, description: str, parameters: dict[str, Any]):
    """
    Decorator to register a function as a tool for Claude.
    """
    def decorator(func):
        _registered_tools[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "function": func,
        }
        return func
    return decorator


def get_tools_schema() -> list[dict[str, Any]]:
    """Get the tools schema for Claude API."""
    tools = []
    for name, tool_def in _registered_tools.items():
        # Convert simple type hints to JSON schema
        properties = {}
        required = []

        for param_name, param_type in tool_def["parameters"].items():
            if param_type == str:
                properties[param_name] = {"type": "string"}
            elif param_type == int:
                properties[param_name] = {"type": "integer"}
            elif param_type == bool:
                properties[param_name] = {"type": "boolean"}
            elif param_type == dict:
                properties[param_name] = {"type": "object"}
            elif param_type == list:
                properties[param_name] = {"type": "array"}
            else:
                properties[param_name] = {"type": "string"}

            # All parameters are optional by default
            # required.append(param_name)

        tools.append({
            "name": name,
            "description": tool_def["description"],
            "input_schema": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        })

    return tools


async def execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a registered tool by name."""
    if name not in _registered_tools:
        return {"error": f"Unknown tool: {name}"}

    tool_def = _registered_tools[name]
    func = tool_def["function"]

    try:
        if asyncio.iscoroutinefunction(func):
            result = await func(args)
        else:
            result = func(args)
        return result
    except Exception as e:
        logger.error(f"Error executing tool {name}: {e}")
        return {"error": str(e)}


# =============================================================================
# Presentation Tools (10 tools based on Jerry's implementation)
# =============================================================================


@tool("create_presentation", "Create a new presentation with the given title", {"title": str})
async def tool_create_presentation(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new presentation with the given title."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    title = args.get("title", "Untitled Presentation")
    session.presentation = Presentation(title=title)
    session.pending_edits = []
    session.applied_edits = []

    return {"success": True, "title": title, "slide_count": 0}


@tool("add_slide", "Add a new slide with HTML content at the specified position", {
    "html": str,
    "position": int,
    "layout": str,
})
async def tool_add_slide(args: dict[str, Any]) -> dict[str, Any]:
    """Add a new slide to the presentation."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation created. Use create_presentation first."}

    html = args.get("html", "")
    position = args.get("position")
    layout_str = args.get("layout", "blank")

    try:
        layout = SlideLayout(layout_str)
    except ValueError:
        layout = SlideLayout.BLANK

    # Calculate position considering pending adds
    pending_add_count = sum(1 for e in session.pending_edits if e.operation == "ADD")
    current_slide_count = len(session.presentation.slides)

    if position is None or position >= (current_slide_count + pending_add_count):
        index = current_slide_count + pending_add_count
    else:
        index = max(0, position)

    edit = PendingEdit(
        edit_id=str(uuid.uuid4()),
        slide_index=index,
        operation="ADD",
        params={"html": html, "layout": layout.value},
        preview=f"Add slide at position {index + 1}",
    )
    session.pending_edits.append(edit)

    return {"success": True, "slide_index": index, "edit_id": edit.edit_id}


@tool("update_slide", "Update an existing slide's HTML content", {
    "slide_index": int,
    "html": str,
})
async def tool_update_slide(args: dict[str, Any]) -> dict[str, Any]:
    """Update the content of an existing slide."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation loaded"}

    slide_index = args.get("slide_index", 0)
    html = args.get("html", "")

    if slide_index < 0 or slide_index >= len(session.presentation.slides):
        return {"error": f"Invalid slide index: {slide_index}"}

    edit = PendingEdit(
        edit_id=str(uuid.uuid4()),
        slide_index=slide_index,
        operation="UPDATE",
        params={"html": html},
        preview=f"Update slide {slide_index + 1}",
    )
    session.pending_edits.append(edit)

    return {"success": True, "slide_index": slide_index, "edit_id": edit.edit_id}


@tool("delete_slide", "Delete a slide from the presentation", {"slide_index": int})
async def tool_delete_slide(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a slide from the presentation."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation loaded"}

    slide_index = args.get("slide_index", 0)

    if slide_index < 0 or slide_index >= len(session.presentation.slides):
        return {"error": f"Invalid slide index: {slide_index}"}

    edit = PendingEdit(
        edit_id=str(uuid.uuid4()),
        slide_index=slide_index,
        operation="DELETE",
        params={},
        preview=f"Delete slide {slide_index + 1}",
    )
    session.pending_edits.append(edit)

    return {"success": True, "slide_index": slide_index, "edit_id": edit.edit_id}


@tool("reorder_slides", "Move a slide to a new position", {
    "from_index": int,
    "to_index": int,
})
async def tool_reorder_slides(args: dict[str, Any]) -> dict[str, Any]:
    """Reorder slides in the presentation."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation loaded"}

    from_index = args.get("from_index", 0)
    to_index = args.get("to_index", 0)
    num_slides = len(session.presentation.slides)

    if from_index < 0 or from_index >= num_slides:
        return {"error": f"Invalid from_index: {from_index}"}
    if to_index < 0 or to_index >= num_slides:
        return {"error": f"Invalid to_index: {to_index}"}

    edit = PendingEdit(
        edit_id=str(uuid.uuid4()),
        slide_index=from_index,
        operation="REORDER",
        params={"to_index": to_index},
        preview=f"Move slide {from_index + 1} to position {to_index + 1}",
    )
    session.pending_edits.append(edit)

    return {"success": True, "from_index": from_index, "to_index": to_index}


@tool("list_slides", "List all slides in the presentation with previews", {})
async def tool_list_slides(args: dict[str, Any]) -> dict[str, Any]:
    """List all slides with their index and content preview."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"slides": [], "count": 0}

    slides = []
    for slide in session.presentation.slides:
        # Strip HTML tags for preview
        preview = slide.html[:200].replace("<", " <").replace(">", "> ")
        preview = re.sub(r"<[^>]+>", "", preview).strip()
        preview = " ".join(preview.split())[:100]

        slides.append({
            "index": slide.index,
            "layout": slide.layout.value,
            "preview": preview,
            "has_notes": bool(slide.notes),
        })

    return {"slides": slides, "count": len(slides)}


@tool("get_slide", "Get the full details of a specific slide", {"slide_index": int})
async def tool_get_slide(args: dict[str, Any]) -> dict[str, Any]:
    """Get the full HTML content and details of a slide."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation loaded"}

    slide_index = args.get("slide_index", 0)

    if slide_index < 0 or slide_index >= len(session.presentation.slides):
        return {"error": f"Invalid slide index: {slide_index}"}

    slide = session.presentation.slides[slide_index]

    return {
        "index": slide.index,
        "html": slide.html,
        "layout": slide.layout.value,
        "notes": slide.notes,
    }


@tool("set_theme", "Set the presentation theme (colors, fonts, etc.)", {"theme": dict})
async def tool_set_theme(args: dict[str, Any]) -> dict[str, Any]:
    """Set the presentation theme."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation created"}

    theme = args.get("theme", {})
    session.presentation.theme = theme

    return {"success": True, "theme": theme}


@tool("get_pending_edits", "Get all pending edits that haven't been committed yet", {})
async def tool_get_pending_edits(args: dict[str, Any]) -> dict[str, Any]:
    """Get all pending edits."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    edits = [
        {
            "edit_id": e.edit_id,
            "slide_index": e.slide_index,
            "operation": e.operation,
            "preview": e.preview,
        }
        for e in session.pending_edits
    ]

    return {"edits": edits, "count": len(edits)}


@tool("commit_edits", "Apply all pending edits to the presentation", {})
async def tool_commit_edits(args: dict[str, Any]) -> dict[str, Any]:
    """Apply all pending edits atomically."""
    session = get_current_session()
    if not session:
        return {"error": "No active session"}

    if not session.presentation:
        return {"error": "No presentation created"}

    applied_count = 0

    for edit in session.pending_edits:
        try:
            if edit.operation == "ADD":
                slide = Slide(
                    index=edit.slide_index,
                    html=edit.params.get("html", ""),
                    layout=SlideLayout(edit.params.get("layout", "blank")),
                )
                if edit.slide_index >= len(session.presentation.slides):
                    session.presentation.slides.append(slide)
                else:
                    session.presentation.slides.insert(edit.slide_index, slide)
                # Re-index slides
                for i, s in enumerate(session.presentation.slides):
                    s.index = i

            elif edit.operation == "UPDATE":
                if 0 <= edit.slide_index < len(session.presentation.slides):
                    session.presentation.slides[edit.slide_index].html = edit.params.get("html", "")

            elif edit.operation == "DELETE":
                if 0 <= edit.slide_index < len(session.presentation.slides):
                    del session.presentation.slides[edit.slide_index]
                    # Re-index slides
                    for i, s in enumerate(session.presentation.slides):
                        s.index = i

            elif edit.operation == "REORDER":
                to_index = edit.params.get("to_index", 0)
                if 0 <= edit.slide_index < len(session.presentation.slides):
                    slide = session.presentation.slides.pop(edit.slide_index)
                    session.presentation.slides.insert(to_index, slide)
                    # Re-index slides
                    for i, s in enumerate(session.presentation.slides):
                        s.index = i

            session.applied_edits.append(edit.to_dict())
            applied_count += 1

        except Exception as e:
            logger.error(f"Error applying edit {edit.edit_id}: {e}")

    # Clear pending edits
    session.pending_edits = []

    # Save session state
    save_session(session)

    return {
        "success": True,
        "applied_count": applied_count,
        "total_slides": len(session.presentation.slides),
    }


# =============================================================================
# System Prompts
# =============================================================================

SYSTEM_PROMPT_NEW = """You are a presentation creation assistant for Flash Reports.
You help users create professional PowerPoint presentations from their project portfolio data.

## Slide Dimensions
All slides must use these exact dimensions:
- Width: 960px
- Height: 540px
- Use CSS: width: 960px; height: 540px; overflow: hidden; box-sizing: border-box;

## Workflow
1. When the user provides project data, analyze it and propose a presentation structure
2. Use create_presentation to start
3. Use add_slide to add slides with HTML content
4. Use commit_edits to apply changes
5. Ask for feedback and iterate

## Design Guidelines
- Use a clean, professional design
- Use consistent colors for status indicators:
  - Green (#22c55e): completed, sunny, low risk
  - Yellow (#eab308): in progress, cloudy, medium risk
  - Red (#ef4444): delayed, stormy, high risk
- Include clear project names on each slide
- Use tables for budget and effort data
- Keep text concise and readable

## HTML Best Practices
- Use inline styles for all styling
- Use flexbox for layout
- Ensure text contrasts well with backgrounds
- Use appropriate font sizes (titles: 32-48px, body: 16-24px)
"""

SYSTEM_PROMPT_CONTINUE = """You are continuing to edit an existing presentation.
The user may want to modify specific slides or add new content.

IMPORTANT: Before making any changes, you MUST ask the user for explicit confirmation.
Do not modify slides without permission.

## Available Actions
- View slides with list_slides and get_slide
- Add new slides with add_slide
- Update existing slides with update_slide
- Delete slides with delete_slide
- Reorder slides with reorder_slides
- Always commit_edits after making changes

## Slide Dimensions
All slides must use: width: 960px; height: 540px; overflow: hidden;
"""


# =============================================================================
# Agent Streaming
# =============================================================================


def _build_user_message(
    message: str,
    projects_data: Optional[list[dict]] = None,
    mapping_json: Optional[dict] = None,
) -> str:
    """Build the user message with project data context."""
    parts = [message]

    if projects_data:
        parts.append("\n\n## Project Data\n```json\n")
        parts.append(json.dumps(projects_data, indent=2)[:10000])  # Limit size
        parts.append("\n```")

    if mapping_json:
        parts.append("\n\n## Field Mapping\n```json\n")
        parts.append(json.dumps(mapping_json, indent=2))
        parts.append("\n```")

    return "".join(parts)


async def run_agent_stream(
    session_id: str,
    message: str,
    projects_data: Optional[list[dict]] = None,
    mapping_json: Optional[dict] = None,
) -> AsyncGenerator[str, None]:
    """
    Run the agent and stream responses as SSE events.

    Yields SSE-formatted strings:
    - event: init
    - event: status
    - event: tool_use
    - event: tool_result
    - event: assistant
    - event: complete
    - event: error
    """
    settings = get_settings()

    # Load session and set in context
    session = load_session(session_id)
    set_current_session(session)

    # Determine system prompt based on session state
    is_new = session.presentation is None
    system_prompt = SYSTEM_PROMPT_NEW if is_new else SYSTEM_PROMPT_CONTINUE

    # Build user message with context
    user_message = _build_user_message(message, projects_data, mapping_json)

    # Initialize Anthropic client
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Get tools schema
    tools = get_tools_schema()

    # Yield init event
    yield f"event: init\ndata: {json.dumps({'session_id': session_id, 'is_new': is_new})}\n\n"

    try:
        # Initial message history
        messages = [{"role": "user", "content": user_message}]

        # Agentic loop - continue until no more tool calls
        while True:
            yield f"event: status\ndata: {json.dumps({'status': 'thinking'})}\n\n"

            # Call Claude
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=8192,
                system=system_prompt,
                tools=tools,
                messages=messages,
            )

            # Process response content
            assistant_content = []
            tool_calls = []

            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                    yield f"event: assistant\ndata: {json.dumps({'text': block.text})}\n\n"

                elif block.type == "tool_use":
                    tool_calls.append(block)
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                    yield f"event: tool_use\ndata: {json.dumps({'tool': block.name, 'input': block.input})}\n\n"

            # Add assistant message to history
            messages.append({"role": "assistant", "content": assistant_content})

            # If no tool calls or stop reason is end_turn, we're done
            if not tool_calls or response.stop_reason == "end_turn":
                break

            # Execute tool calls and add results
            tool_results = []
            for tool_call in tool_calls:
                yield f"event: status\ndata: {json.dumps({'status': 'executing', 'tool': tool_call.name})}\n\n"

                result = await execute_tool(tool_call.name, tool_call.input)

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "content": json.dumps(result),
                })

                yield f"event: tool_result\ndata: {json.dumps({'tool': tool_call.name, 'result': result})}\n\n"

            # Add tool results to messages
            messages.append({"role": "user", "content": tool_results})

        # Get final session state
        final_session = get_current_session()
        slides_data = []
        if final_session and final_session.presentation:
            slides_data = [s.to_dict() for s in final_session.presentation.slides]

        yield f"event: complete\ndata: {json.dumps({'session_id': session_id, 'slides': slides_data})}\n\n"

    except Exception as e:
        logger.error(f"Agent error: {e}")
        yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    finally:
        # Clear session context
        set_current_session(None)
