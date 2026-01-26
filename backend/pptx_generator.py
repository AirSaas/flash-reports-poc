"""
PPTX Generator using Claude PPTX Skill.
This is the main generation engine that creates PowerPoint files.
"""

import json
import logging
from datetime import datetime
from typing import Any, Optional

import anthropic

from config import get_settings
import database as db
from airsaas import compress_project_data, estimate_tokens

logger = logging.getLogger(__name__)

MAX_DATA_TOKENS = 12000


def apply_long_text_strategy(
    data: list[dict[str, Any]],
    strategy: Optional[str],
) -> list[dict[str, Any]]:
    """Apply the user's long text strategy to the data."""
    long_text_fields = ["description", "content", "body", "notes", "comment", "summary", "details", "text"]

    def process_value(value: Any, depth: int = 0) -> Any:
        if depth > 5:
            return value

        if isinstance(value, str) and len(value) > 100:
            if strategy == "summarize":
                return value[:300] + " [to be summarized]" if len(value) > 300 else value
            elif strategy == "ellipsis":
                return value[:100] + "..."
            elif strategy == "omit":
                return "[long text omitted]" if len(value) > 200 else value
            else:
                return value[:200] + "..." if len(value) > 200 else value

        if isinstance(value, list):
            return [process_value(item, depth + 1) for item in value[:20]]

        if isinstance(value, dict):
            result = {}
            for key, val in value.items():
                if key in long_text_fields and isinstance(val, str):
                    result[key] = process_value(val, depth + 1)
                else:
                    result[key] = process_value(val, depth + 1)
            return result

        return value

    return [process_value(project) for project in data]


def build_prompt_from_mapping(
    mapping_json: dict[str, Any],
    fetched_data: list[dict[str, Any]],
    long_text_strategy: Optional[str],
    use_template: bool = False,
) -> str:
    """Build the prompt for Claude PPTX generation."""
    strategy_instructions = {
        "summarize": "Summarize long texts to a maximum of 2 sentences",
        "ellipsis": 'Truncate long texts with "..." after 100 characters',
        "omit": "Omit fields with very long texts",
    }.get(long_text_strategy, "Keep texts at reasonable length for slides")

    if use_template:
        return f"""I've uploaded a PPTX template file. Use this template as the BASE for generating the report.

## CRITICAL INSTRUCTIONS
1. First, analyze the uploaded template to understand:
   - The slide layouts and structure
   - The position and size of each text placeholder
   - The fonts, colors, and visual style
2. For EACH PROJECT in the data, duplicate the template slides and populate them
3. **PRESERVE** the original template's design exactly - same colors, fonts, positions, sizes
4. **CRITICAL**: Text must FIT within each placeholder's boundaries:
   - NEVER let text overflow or overlap other elements
   - Reduce font size if needed to fit the space
   - Use the placeholder's original font size as maximum

## Project Data
{json.dumps(fetched_data, indent=2)}

## Field Mapping (template field -> data source)
{json.dumps(mapping_json, indent=2)}

## Long Text Strategy (USER SELECTED - FOLLOW STRICTLY)
{strategy_instructions}

Apply the above strategy to ALL text fields. This is the user's choice for handling long texts.

## Text Fitting Rules (VERY IMPORTANT)
- Text MUST fit within its placeholder container
- If text still doesn't fit after applying the long text strategy, reduce font size
- NEVER allow text to overflow, overlap, or extend beyond placeholder boundaries
- Maintain readability - minimum font size should be 8pt

## Output Structure
1. For each project: duplicate the template slides and fill with that project's data
2. Add a summary slide at the beginning listing all projects  
3. Maintain consistent visual style throughout

## Output Requirements
Save the final PPTX to /mnt/outputs/report.pptx

Generate the PPTX file now using the uploaded template as the base."""
    else:
        return f"""Generate a PowerPoint presentation for the project portfolio with the following data:

## Project Data
{json.dumps(fetched_data, indent=2)}

## Field Mapping
{json.dumps(mapping_json, indent=2)}

## Long Text Strategy
{strategy_instructions}

## Required Structure
1. Summary slide with a list of all projects and their status/mood
2. For each project: slides according to the mapping (Card, Progress, Planning)
3. Final slide listing fields that could not be populated

## Design Guidelines
- Use a professional, clean design
- Use consistent colors for status indicators:
  - Green: completed/sunny/low risk
  - Yellow: in progress/cloudy/medium risk
  - Red: delayed/stormy/high risk
- Include project names clearly on each slide
- Use tables for budget and effort data
- Use timelines or Gantt-style visuals for milestones

## IMPORTANT: Output Requirements
You MUST generate and save the PPTX file to /mnt/outputs/report.pptx
After creating the presentation, make sure to save it using the python-pptx library or similar.
The file MUST be saved to the outputs directory for it to be accessible.

Generate the PPTX file now and save it to /mnt/outputs/report.pptx"""


async def generate_pptx_with_claude(
    job_id: str,
    session_id: str,
    mapping_json: dict[str, Any],
    long_text_strategy: Optional[str],
    fetched_data: list[dict[str, Any]],
    template_path: Optional[str] = None,
) -> dict[str, Any]:
    """
    Generate a PPTX file using Claude PPTX Skill.

    Args:
        job_id: Job ID for logging
        session_id: Session ID
        mapping_json: Field mapping configuration
        long_text_strategy: Strategy for handling long text
        fetched_data: Project data to populate
        template_path: Optional path to template in Supabase Storage

    Returns:
        Result dict with reportId, pptxUrl, storagePath, iteration
    """
    settings = get_settings()
    supabase = db.get_supabase()

    logger.info(f"[JOB {job_id}] Processing {len(fetched_data)} projects...")

    # Apply long text strategy
    data_for_prompt = apply_long_text_strategy(fetched_data, long_text_strategy)
    logger.info(f"After applying strategy: {estimate_tokens(data_for_prompt)} tokens")

    # Compress data aggressively
    data_for_prompt = compress_project_data(data_for_prompt, 50)
    compressed_tokens = estimate_tokens(data_for_prompt)
    logger.info(f"After compression (50 char): {compressed_tokens} tokens")

    if compressed_tokens > MAX_DATA_TOKENS:
        data_for_prompt = compress_project_data(data_for_prompt, 30)
        compressed_tokens = estimate_tokens(data_for_prompt)
        logger.info(f"After compression (30 char): {compressed_tokens} tokens")

    if compressed_tokens > MAX_DATA_TOKENS:
        ratio = MAX_DATA_TOKENS / compressed_tokens
        max_projects = max(3, int(ratio * len(data_for_prompt)))
        data_for_prompt = data_for_prompt[:max_projects]
        compressed_tokens = estimate_tokens(data_for_prompt)
        logger.info(f"After limiting to {max_projects} projects: {compressed_tokens} tokens")

    if compressed_tokens > 15000:
        data_for_prompt = data_for_prompt[:4]
        compressed_tokens = estimate_tokens(data_for_prompt)
        logger.info(f"Final safety limit (4 projects): {compressed_tokens} tokens")

    # Initialize Anthropic client
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Upload template to Anthropic if provided
    template_file_id = None
    if template_path:
        logger.info(f"[JOB {job_id}] Downloading template from Supabase: {template_path}")
        try:
            template_data = supabase.storage.from_("templates").download(template_path)
            if template_data:
                logger.info(f"[JOB {job_id}] Uploading template to Anthropic ({len(template_data)} bytes)...")
                filename = template_path.split("/")[-1] or "template.pptx"
                uploaded_file = client.beta.files.upload(
                    file=(filename, template_data, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
                )
                template_file_id = uploaded_file.id
                logger.info(f"[JOB {job_id}] Template uploaded to Anthropic: {template_file_id}")
        except Exception as e:
            logger.warning(f"[JOB {job_id}] Failed to upload template: {e}. Generating without template.")
            template_file_id = None

    # Build prompt (with or without template)
    use_template = template_file_id is not None
    prompt = build_prompt_from_mapping(mapping_json, data_for_prompt, long_text_strategy, use_template)
    logger.info(f"Final prompt tokens estimate: {estimate_tokens(prompt)}")

    # Build message content
    if template_file_id:
        message_content = [
            {"type": "container_upload", "file_id": template_file_id},
            {"type": "text", "text": prompt},
        ]
    else:
        message_content = prompt

    # Helper function to cleanup uploaded template file
    def cleanup_template_file():
        if template_file_id:
            try:
                client.beta.files.delete(
                    file_id=template_file_id,
                    betas=["files-api-2025-04-14"]
                )
                logger.info(f"[JOB {job_id}] Cleaned up template file from Anthropic: {template_file_id}")
            except Exception as cleanup_error:
                logger.warning(f"[JOB {job_id}] Failed to cleanup template file: {cleanup_error}")

    try:
        logger.info(f"[JOB {job_id}] [STEP 1/6] Calling Claude API with PPTX Skill{' (with template)' if use_template else ''}...")
        start_time = datetime.utcnow()

        # Call Claude with PPTX Skill
        response = client.beta.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=16384,
            betas=["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
            container={
                "skills": [
                    {
                        "type": "anthropic",
                        "skill_id": "pptx",
                        "version": "latest",
                    }
                ]
            },
            messages=[{"role": "user", "content": message_content}],
            tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
        )

        elapsed_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
        logger.info(f"[JOB {job_id}] [STEP 2/6] Claude API responded in {elapsed_ms:.0f}ms ({elapsed_ms/1000:.1f}s)")
        logger.info(f"Claude response stop_reason: {response.stop_reason}")

        # Extract file_id from response using official Anthropic pattern
        # Files are found in bash_code_execution_tool_result blocks
        file_ids = []

        def extract_file_ids_from_response(resp) -> list[dict]:
            """Extract file IDs following Anthropic's official documentation pattern."""
            found_files = []
            for item in resp.content:
                logger.info(f"Processing block type: {item.type}")

                # Pattern 1: bash_code_execution_tool_result (most common for PPTX skill)
                if item.type == "bash_code_execution_tool_result":
                    content_item = getattr(item, "content", None)
                    if content_item:
                        # Check if content has type attribute
                        if hasattr(content_item, "type") and content_item.type == "bash_code_execution_result":
                            inner_content = getattr(content_item, "content", [])
                            if isinstance(inner_content, list):
                                for file_item in inner_content:
                                    if hasattr(file_item, "file_id"):
                                        found_files.append({
                                            "file_id": file_item.file_id,
                                            "filename": getattr(file_item, "filename", None) or getattr(file_item, "file_name", None)
                                        })
                                        logger.info(f"Found file in bash_code_execution_tool_result: {file_item.file_id}")
                        # Also check if content itself is a list
                        elif isinstance(content_item, list):
                            for sub_item in content_item:
                                if hasattr(sub_item, "file_id"):
                                    found_files.append({
                                        "file_id": sub_item.file_id,
                                        "filename": getattr(sub_item, "filename", None)
                                    })
                                    logger.info(f"Found file in content list: {sub_item.file_id}")

                # Pattern 2: text_editor_code_execution_tool_result
                elif item.type == "text_editor_code_execution_tool_result":
                    content_item = getattr(item, "content", None)
                    if content_item and hasattr(content_item, "content"):
                        inner_content = getattr(content_item, "content", [])
                        if isinstance(inner_content, list):
                            for file_item in inner_content:
                                if hasattr(file_item, "file_id"):
                                    found_files.append({
                                        "file_id": file_item.file_id,
                                        "filename": getattr(file_item, "filename", None)
                                    })
                                    logger.info(f"Found file in text_editor result: {file_item.file_id}")

                # Pattern 3: Direct file block
                elif item.type == "file":
                    if hasattr(item, "file_id"):
                        found_files.append({
                            "file_id": item.file_id,
                            "filename": getattr(item, "filename", None)
                        })
                        logger.info(f"Found direct file block: {item.file_id}")

            return found_files

        file_ids = extract_file_ids_from_response(response)

        # Log all block types for debugging
        block_types = [b.type for b in response.content]
        logger.info(f"Response content blocks: {block_types}")
        logger.info(f"Found {len(file_ids)} files in response")

        # Find PPTX file (prefer .pptx extension)
        file_id = None
        file_name = None

        for f in file_ids:
            fname = f.get("filename", "") or ""
            if fname.endswith(".pptx"):
                file_id = f["file_id"]
                file_name = fname
                logger.info(f"Selected PPTX file: {file_id} ({file_name})")
                break

        # If no PPTX found, use first file
        if not file_id and file_ids:
            file_id = file_ids[0]["file_id"]
            file_name = file_ids[0].get("filename")
            logger.info(f"No PPTX found, using first file: {file_id} ({file_name})")

        if not file_id:
            # Log more details for debugging
            logger.error("No files found in response. Dumping block details:")
            for i, block in enumerate(response.content):
                block_str = str(block)
                logger.error(f"Block {i} ({block.type}): {block_str[:1000]}{'...' if len(block_str) > 1000 else ''}")
            raise Exception("No PPTX file generated - could not find file_id in response. Claude may have executed code but did not save the file to /mnt/outputs/")

        logger.info(f"[JOB {job_id}] [STEP 3/6] Found file_id: {file_id}, downloading from Anthropic...")

        # Get file metadata first (optional but useful for logging)
        try:
            file_metadata = client.beta.files.retrieve_metadata(
                file_id=file_id,
                betas=["files-api-2025-04-14"]
            )
            logger.info(f"File metadata: {file_metadata.filename}, {file_metadata.size_bytes} bytes")
        except Exception as e:
            logger.warning(f"Could not retrieve file metadata: {e}")

        # Download file from Anthropic Files API using the documented method
        file_response = client.beta.files.download(
            file_id=file_id,
            betas=["files-api-2025-04-14"]
        )
        file_buffer = file_response.read()

        logger.info(f"[JOB {job_id}] [STEP 4/6] Downloaded file ({len(file_buffer) / 1024:.1f} KB), uploading to Supabase Storage...")

        # Upload to Supabase Storage
        file_name = f"{int(datetime.utcnow().timestamp() * 1000)}_report.pptx"
        storage_path = f"{session_id}/{file_name}"

        supabase.storage.from_("outputs").upload(
            storage_path,
            file_buffer,
            {"content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
        )

        logger.info(f"[JOB {job_id}] [STEP 5/6] Uploaded to storage: {storage_path}, saving report record...")

        # Get iteration count
        report_count = db.get_report_count(session_id)
        iteration = report_count + 1

        # Save report reference
        report = db.create_report(
            session_id=session_id,
            engine="claude-pptx",
            pptx_path=storage_path,
            iteration=iteration,
        )

        # Get public URL
        public_url = db.get_public_url("outputs", storage_path)

        logger.info(f"[JOB {job_id}] [STEP 6/6] Report saved successfully!")

        total_elapsed = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"✅ Job {job_id} completed successfully in {total_elapsed:.1f}s")

        return {
            "reportId": report.id,
            "pptxUrl": public_url,
            "storagePath": storage_path,
            "iteration": iteration,
        }
    finally:
        # Always cleanup uploaded template from Anthropic Files API
        cleanup_template_file()
