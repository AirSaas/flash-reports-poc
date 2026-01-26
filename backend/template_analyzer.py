"""
Template analyzer using Claude with PPTX skill.
"""

import logging
from typing import Any, Tuple

import anthropic

from config import get_settings
import database as db

logger = logging.getLogger(__name__)

# JSON Schema for structured output (additionalProperties: false required by Anthropic)
ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "slides": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "slide_number": {"type": "integer"},
                    "title": {"type": "string"},
                    "fields": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string"},
                                "placeholder_text": {"type": "string"},
                                "data_type": {
                                    "type": "string",
                                    "enum": ["text", "number", "date", "list", "image"],
                                },
                                "location": {
                                    "type": "string",
                                    "enum": ["title", "subtitle", "body", "table", "chart"],
                                },
                            },
                            "required": ["id", "name", "placeholder_text", "data_type", "location"],
                        },
                    },
                },
                "required": ["slide_number", "title", "fields"],
            },
        },
        "total_fields": {"type": "integer"},
        "analysis_notes": {"type": "string"},
    },
    "required": ["slides", "total_fields", "analysis_notes"],
}

ANALYSIS_PROMPT = """You are an expert at analyzing PowerPoint templates. Analyze the uploaded PPTX template and identify all placeholders and fields that need to be filled with data.

For each slide, identify:
1. The slide number and title
2. All placeholders (like {{field}}, [field], {field}, or descriptive text indicating where data should go)
3. The data type each field expects (text, number, date, list, image)
4. The location of each field (title, subtitle, body, table, chart)

Be thorough - capture every field that could be populated with data. If text appears to be a placeholder description (like "Project Name" or "Owner"), include it as a field.

Generate unique IDs for each field using snake_case format (e.g., "project_name", "budget_total")."""


async def upload_template_to_anthropic(
    template_path: str,
    session_id: str,
) -> str:
    """
    Download template from Supabase and upload to Anthropic Files API.
    """
    settings = get_settings()
    supabase = db.get_supabase()

    logger.info(f"Downloading template from Supabase: {template_path}")

    # Download from Supabase Storage
    file_data = supabase.storage.from_("templates").download(template_path)

    if not file_data:
        raise Exception("Failed to download template: No data returned")

    logger.info(f"Downloaded template, size: {len(file_data)} bytes")

    # Upload to Anthropic Files API
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    filename = template_path.split("/")[-1] or "template.pptx"

    logger.info("Uploading to Anthropic Files API...")

    # Upload using the beta files API with tuple format (filename, content, mime_type)
    uploaded_file = client.beta.files.upload(
        file=(filename, file_data, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    )

    logger.info(f"Uploaded to Anthropic, file ID: {uploaded_file.id}")

    return uploaded_file.id


async def analyze_template_with_claude(
    template_path: str,
    session_id: str,
) -> Tuple[dict[str, Any], str]:
    """
    Analyze a PPTX template using Claude to identify fields.

    Returns:
        Tuple of (analysis dict, anthropic_file_id)
    """
    settings = get_settings()

    # Upload template to Anthropic
    anthropic_file_id = await upload_template_to_anthropic(template_path, session_id)

    # Save file ID to session
    db.update_session(session_id, {
        "anthropic_file_id": anthropic_file_id,
        "template_path": template_path,
    })

    logger.info("Calling Claude to analyze template...")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Call Claude with PPTX skill (without structured outputs - may cause 500 errors)
    response = client.beta.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=16384,
        temperature=0,
        betas=["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
        system=ANALYSIS_PROMPT + "\n\nIMPORTANT: Return ONLY valid JSON matching this schema, no other text:\n" + str(ANALYSIS_SCHEMA),
        container={
            "skills": [
                {
                    "type": "anthropic",
                    "skill_id": "pptx",
                    "version": "latest",
                }
            ]
        },
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "container_upload",
                        "file_id": anthropic_file_id,
                    },
                    {
                        "type": "text",
                        "text": "Analyze this PPTX template and return ONLY valid JSON (no markdown, no explanation) with all fields that need to be populated.",
                    },
                ],
            }
        ],
        tools=[
            {
                "type": "code_execution_20250825",
                "name": "code_execution",
            }
        ],
    )

    logger.info(f"Response received, stop_reason: {response.stop_reason}")

    # Extract analysis from response
    analysis = None
    raw_text = ""

    # Collect all text from response
    for block in response.content:
        if block.type == "text":
            raw_text += block.text + "\n"
            logger.info(f"Text block: {block.text[:500]}..." if len(block.text) > 500 else f"Text block: {block.text}")

    # Try to parse the collected text
    import json
    import re

    # Method 1: Direct JSON parse
    try:
        analysis = json.loads(raw_text.strip())
        logger.info("Successfully parsed JSON directly")
    except Exception as e:
        logger.warning(f"Direct JSON parse failed: {e}")

    # Method 2: Extract JSON from markdown code blocks
    if not analysis:
        json_block_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', raw_text)
        if json_block_match:
            try:
                analysis = json.loads(json_block_match.group(1))
                logger.info("Parsed JSON from markdown code block")
            except Exception as e:
                logger.warning(f"Markdown block JSON parse failed: {e}")

    # Method 3: Find JSON object with slides array
    if not analysis:
        # More robust regex to find JSON with slides
        json_match = re.search(r'\{[^{}]*"slides"\s*:\s*\[[\s\S]*?\][^{}]*\}', raw_text)
        if json_match:
            try:
                analysis = json.loads(json_match.group(0))
                logger.info("Parsed JSON from regex (slides pattern)")
            except Exception as e:
                logger.warning(f"Regex JSON parse failed: {e}")

    # Method 4: Try to find any valid JSON object
    if not analysis:
        # Find all potential JSON objects
        for match in re.finditer(r'\{[\s\S]*?\}', raw_text):
            try:
                potential = json.loads(match.group(0))
                if isinstance(potential.get("slides"), list):
                    analysis = potential
                    logger.info("Parsed JSON from general regex search")
                    break
            except Exception:
                continue

    if not analysis:
        logger.error(f"Failed to parse analysis. Raw response: {raw_text[:2000]}")
        raise Exception(f"Failed to parse template analysis from Claude response. Raw: {raw_text[:500]}")

    # Validate structure
    if not analysis.get("slides") or not isinstance(analysis["slides"], list):
        logger.error(f"Invalid analysis structure. Got: {analysis}")
        raise Exception(f"Invalid analysis structure: missing slides array. Got keys: {list(analysis.keys())}")

    logger.info(f"Analysis complete. Total fields: {analysis.get('total_fields', 0)}")

    return analysis, anthropic_file_id
