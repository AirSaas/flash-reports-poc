"""
Chat handler for conversational mapping with Claude.
Supports both streaming and non-streaming responses.
"""

import json
import logging
import re
from typing import Any, AsyncGenerator, Optional

import anthropic

from config import get_settings
import database as db

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert assistant specialized in mapping PowerPoint template fields to AirSaas project data.

Your job is to:
1. Analyze the uploaded PPTX template structure (slides, placeholders, text fields)
2. Propose matches with available AirSaas API fields
3. Ask the user only when there is ambiguity
4. Generate a final mapping_json when the mapping is complete

Available AirSaas API fields per project:
- project.name (project name)
- project.short_id (short project ID like AQM-P8)
- project.description (description)
- project.status (status object with name)
- project.mood (mood object with name: sunny, cloudy, rainy, stormy)
- project.risk (risk object with name: low, medium, high)
- project.owner (owner object with first_name, last_name, email)
- project.program (program object with name)
- project.goals[] (array of goal objects)
- project.teams[] (array of team objects)
- project.milestones[] (milestones with name, due_date, status)
- project.members[] (project members)
- project.efforts[] (team efforts with planned, actual values)
- project.budget_lines[] (budget lines with name, amount)
- project.budget_values[] (budget values)
- project.attention_points[] (attention points with title, description)
- project.decisions[] (decisions with title, status)

When you propose a match, use this format:
- Template field: "X" → AirSaas field: "Y" ✓

If no match is found, indicate:
- Template field: "X" → No available match (missing)

When the mapping is COMPLETE and the user has confirmed (or you have proposed all matches), generate a JSON with this structure:
```json
{
  "slides": {
    "slide_1": {
      "field_name": { "source": "project.name", "status": "ok" },
      "another_field": { "source": "project.mood.name", "status": "ok" }
    },
    "slide_2": {
      "field_name": { "source": "project.milestones", "status": "ok" }
    }
  },
  "missing_fields": ["field1", "field2"]
}
```

Important:
- Be concise and propose matches directly based on the template analysis
- If the template doesn't have explicit placeholders, infer fields from the slide content
- The user will review your proposals - ask for confirmation at the end
- Generate the final JSON after the user confirms (or if they say "yes", "ok", "looks good", etc.)"""


async def upload_template_to_anthropic(
    client: anthropic.Anthropic,
    template_path: str,
) -> str:
    """Upload template to Anthropic Files API."""
    supabase = db.get_supabase()

    logger.info(f"Downloading template from Supabase: {template_path}")

    # Download from Supabase Storage
    file_data = supabase.storage.from_("templates").download(template_path)

    if not file_data:
        raise Exception("Failed to download template")

    logger.info(f"Downloaded template, size: {len(file_data)} bytes")

    # Upload to Anthropic
    import io
    file_obj = io.BytesIO(file_data)
    file_obj.name = template_path.split("/")[-1] or "template.pptx"

    uploaded_file = client.beta.files.upload(
        file=file_obj,
        betas=["files-api-2025-04-14"],
    )

    logger.info(f"Uploaded to Anthropic, file ID: {uploaded_file.id}")
    return uploaded_file.id


async def handle_chat_message(
    session_id: str,
    message: str,
) -> dict[str, Any]:
    """
    Handle a non-streaming chat message.

    Returns:
        Response with message, mappingComplete flag, and optional mappingJson
    """
    settings = get_settings()
    supabase = db.get_supabase()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Get session
    result = supabase.table("sessions").select("*").eq("id", session_id).single().execute()
    session_data = result.data if result.data else {}

    chat_history = session_data.get("chat_history", [])
    anthropic_file_id = session_data.get("anthropic_file_id")
    template_path = session_data.get("template_path")

    # Check if this is a new mapping session (contains template path)
    template_path_match = re.search(r"template at: ([^\n]+\.pptx)", message, re.IGNORECASE)
    is_first_message = len(chat_history) == 0

    if template_path_match:
        chat_history = []
        is_first_message = True
        anthropic_file_id = None
        logger.info("New mapping session detected, resetting chat history")

    # Upload template if first message with template path
    if template_path_match and is_first_message:
        template_path = template_path_match.group(1).strip()
        try:
            anthropic_file_id = await upload_template_to_anthropic(client, template_path)
            supabase.table("sessions").update({
                "anthropic_file_id": anthropic_file_id,
                "template_path": template_path,
            }).eq("id", session_id).execute()
        except Exception as e:
            logger.error(f"Failed to upload template: {e}")

    # Add user message to history
    chat_history.append({"role": "user", "content": message})

    # Build API messages
    api_messages = []
    for i, msg in enumerate(chat_history):
        if i == len(chat_history) - 1 and msg["role"] == "user" and anthropic_file_id and is_first_message:
            # First message with file
            api_messages.append({
                "role": "user",
                "content": [
                    {"type": "container_upload", "file_id": anthropic_file_id},
                    {"type": "text", "text": "Please analyze this PPTX template file. Identify all slides, their text content, and any placeholders. Then propose field mappings to AirSaas project data."},
                ],
            })
        else:
            api_messages.append({
                "role": msg["role"],
                "content": msg["content"],
            })

    logger.info("Calling Claude...")

    # Call Claude
    response = client.beta.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=8192,
        betas=["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
        system=SYSTEM_PROMPT,
        container={
            "skills": [{"type": "anthropic", "skill_id": "pptx", "version": "latest"}],
        },
        messages=api_messages,
        tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
    )

    # Extract response text
    assistant_message = ""
    for block in response.content:
        if block.type == "text":
            assistant_message += block.text

    # Add to history
    chat_history.append({"role": "assistant", "content": assistant_message})

    # Detect mapping completion
    mapping_complete = False
    mapping_json = None
    mapping_id = None

    json_match = re.search(r"```json\n([\s\S]*?)\n```", assistant_message)
    if json_match:
        try:
            mapping_json = json.loads(json_match.group(1))
            if mapping_json.get("slides") and "missing_fields" in mapping_json:
                mapping_complete = True
        except Exception:
            pass

    # Update session
    supabase.table("sessions").update({
        "chat_history": chat_history,
        "current_step": "long_text_options" if mapping_complete else "mapping",
    }).eq("id", session_id).execute()

    # Save mapping if complete
    if mapping_complete and mapping_json:
        mapping = db.get_mapping_by_session(session_id)
        if mapping:
            db.update_mapping(mapping.id, {"mapping_json": mapping_json})
            mapping_id = mapping.id
        else:
            new_mapping = db.create_mapping(
                session_id=session_id,
                mapping_json=mapping_json,
                template_path=template_path,
            )
            mapping_id = new_mapping.id

    return {
        "message": assistant_message,
        "mappingComplete": mapping_complete,
        "mappingJson": mapping_json,
        "mappingId": mapping_id,
    }


async def handle_chat_stream(
    session_id: str,
    message: str,
) -> AsyncGenerator[str, None]:
    """
    Handle a streaming chat message.

    Yields SSE events:
    - data: {"type": "delta", "text": "..."}
    - data: {"type": "done", "message": "...", "mappingComplete": bool, ...}
    """
    settings = get_settings()
    supabase = db.get_supabase()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        # Get session
        result = supabase.table("sessions").select("*").eq("id", session_id).single().execute()
        session_data = result.data if result.data else {}

        chat_history = session_data.get("chat_history", [])
        anthropic_file_id = session_data.get("anthropic_file_id")
        template_path = session_data.get("template_path")

        # Check for new mapping session
        template_path_match = re.search(r"template at: ([^\n]+\.pptx)", message, re.IGNORECASE)
        is_first_message = len(chat_history) == 0

        if template_path_match:
            chat_history = []
            is_first_message = True
            anthropic_file_id = None

        # Upload template if needed
        if template_path_match and is_first_message:
            template_path = template_path_match.group(1).strip()
            try:
                anthropic_file_id = await upload_template_to_anthropic(client, template_path)
                supabase.table("sessions").update({
                    "anthropic_file_id": anthropic_file_id,
                    "template_path": template_path,
                }).eq("id", session_id).execute()
            except Exception as e:
                logger.error(f"Failed to upload template: {e}")

        # Add user message
        chat_history.append({"role": "user", "content": message})

        # Build API messages
        api_messages = []
        for i, msg in enumerate(chat_history):
            if i == len(chat_history) - 1 and msg["role"] == "user" and anthropic_file_id and is_first_message:
                api_messages.append({
                    "role": "user",
                    "content": [
                        {"type": "container_upload", "file_id": anthropic_file_id},
                        {"type": "text", "text": "Please analyze this PPTX template file. Identify all slides, their text content, and any placeholders. Then propose field mappings to AirSaas project data."},
                    ],
                })
            else:
                api_messages.append({
                    "role": msg["role"],
                    "content": msg["content"],
                })

        logger.info("Calling Claude (streaming)...")

        # Stream response
        assistant_message = ""

        with client.beta.messages.stream(
            model="claude-sonnet-4-5-20250929",
            max_tokens=8192,
            betas=["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
            system=SYSTEM_PROMPT,
            container={
                "skills": [{"type": "anthropic", "skill_id": "pptx", "version": "latest"}],
            },
            messages=api_messages,
            tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
        ) as stream:
            for event in stream:
                if event.type == "content_block_delta":
                    delta = event.delta
                    if hasattr(delta, "text"):
                        assistant_message += delta.text
                        yield f"data: {json.dumps({'type': 'delta', 'text': delta.text})}\n\n"

        # Process completion
        chat_history.append({"role": "assistant", "content": assistant_message})

        # Detect mapping completion
        mapping_complete = False
        mapping_json = None
        mapping_id = None

        json_match = re.search(r"```json\n([\s\S]*?)\n```", assistant_message)
        if json_match:
            try:
                mapping_json = json.loads(json_match.group(1))
                if mapping_json.get("slides") and "missing_fields" in mapping_json:
                    mapping_complete = True
            except Exception:
                pass

        # Update session
        supabase.table("sessions").update({
            "chat_history": chat_history,
            "current_step": "long_text_options" if mapping_complete else "mapping",
        }).eq("id", session_id).execute()

        # Save mapping if complete
        if mapping_complete and mapping_json:
            mapping = db.get_mapping_by_session(session_id)
            if mapping:
                db.update_mapping(mapping.id, {"mapping_json": mapping_json})
                mapping_id = mapping.id
            else:
                new_mapping = db.create_mapping(
                    session_id=session_id,
                    mapping_json=mapping_json,
                    template_path=template_path,
                )
                mapping_id = new_mapping.id

        # Send final event
        yield f"data: {json.dumps({'type': 'done', 'message': assistant_message, 'mappingComplete': mapping_complete, 'mappingJson': mapping_json, 'mappingId': mapping_id})}\n\n"

    except Exception as e:
        logger.error(f"Stream error: {e}")
        yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
