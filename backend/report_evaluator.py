"""
Report evaluator using Claude with PPTX skill.
Evaluates generated PPTX reports for quality and completeness.
"""

import io
import logging
from typing import Any

import anthropic

from config import get_settings
import database as db

logger = logging.getLogger(__name__)

EVALUATION_PROMPT = """You are an expert at evaluating PowerPoint presentations for quality and completeness.

Analyze the uploaded PPTX file and evaluate its quality.

## Scoring Criteria (Total: 100 points)

### Content Structure (0-40 points) - return as "completeness" field
- Presentation has a clear structure with multiple slides
- Each project/section has identifiable content
- Information is organized logically
- No placeholder text like "[PLACEHOLDER]", "TBD", "N/A" repeated excessively

### Data Quality (0-40 points) - return as "accuracy" field
- Content appears to be real data (not lorem ipsum or fake text)
- Numbers, dates, and names look realistic
- No obvious signs of hallucinated or fabricated content
- Fields are populated with meaningful information

### Formatting (0-20 points) - return as "formatting" field
- Professional presentation layout
- Consistent styling across slides
- Readable text (not cut off or overlapping)
- Clear visual hierarchy

## Output Requirements
- score: Total score (0-100), should equal completeness + accuracy + formatting
- completeness: Score for content structure (0-40)
- accuracy: Score for data quality (0-40)
- formatting: Score for visual formatting (0-20)
- projectsFound: Number of distinct projects found in the presentation
- projectsExpected: Use the number provided in the user message
- issues: Array of general issues found
- accuracyIssues: Array of data accuracy issues
- emptyFields: Array of fields that appear empty or have placeholder values
- recommendation: "pass" if score >= 65, otherwise "regenerate"

## Instructions
1. Open and analyze the PPTX file using code execution
2. Count the number of slides and projects found
3. Check for placeholder text, empty fields, or formatting issues
4. Calculate scores for each category (respecting the max points above)
5. Provide your recommendation based on the total score

Return your evaluation as JSON."""


async def upload_pptx_to_anthropic(
    client: anthropic.Anthropic,
    pptx_data: bytes,
    filename: str,
) -> str:
    """Upload PPTX to Anthropic Files API."""
    logger.info(f"Uploading PPTX to Anthropic ({len(pptx_data)} bytes)...")

    file_obj = io.BytesIO(pptx_data)
    file_obj.name = filename

    uploaded_file = client.beta.files.upload(
        file=file_obj,
        betas=["files-api-2025-04-14"],
    )

    logger.info(f"Uploaded to Anthropic, file_id: {uploaded_file.id}")
    return uploaded_file.id


async def delete_anthropic_file(client: anthropic.Anthropic, file_id: str) -> None:
    """Delete file from Anthropic Files API."""
    try:
        logger.info(f"Deleting file {file_id} from Anthropic...")
        client.beta.files.delete(file_id, betas=["files-api-2025-04-14"])
        logger.info(f"File {file_id} deleted successfully")
    except Exception as e:
        logger.error(f"Failed to delete file {file_id}: {e}")


async def evaluate_report_with_claude(
    job_id: str,
    pptx_path: str,
    project_count: int,
) -> dict[str, Any]:
    """
    Evaluate a PPTX report using Claude.

    Returns:
        Evaluation dict with score, completeness, accuracy, formatting, etc.
    """
    settings = get_settings()
    supabase = db.get_supabase()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    anthropic_file_id = None

    try:
        # Step 1: Download PPTX from Supabase Storage
        logger.info(f"[EVAL {job_id}] [STEP 1/4] Downloading PPTX from storage...")

        pptx_data = supabase.storage.from_("outputs").download(pptx_path)
        if not pptx_data:
            raise Exception(f"Failed to download PPTX: {pptx_path}")

        logger.info(f"[EVAL {job_id}] Downloaded PPTX: {len(pptx_data) / 1024:.1f} KB")

        # Step 2: Upload to Anthropic Files API
        logger.info(f"[EVAL {job_id}] [STEP 2/4] Uploading to Anthropic Files API...")

        filename = pptx_path.split("/")[-1] or "report.pptx"
        anthropic_file_id = await upload_pptx_to_anthropic(client, pptx_data, filename)

        # Step 3: Call Claude to evaluate
        logger.info(f"[EVAL {job_id}] [STEP 3/4] Calling Claude to evaluate...")

        response = client.beta.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            temperature=0,
            betas=["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
            system=EVALUATION_PROMPT,
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
                            "text": f"Analyze this PPTX presentation and evaluate its quality. It should contain approximately {project_count} projects. Return your evaluation as JSON with these exact fields: score, completeness, accuracy, formatting, projectsFound, projectsExpected, issues (array), accuracyIssues (array), emptyFields (array), recommendation (\"pass\" or \"regenerate\").",
                        },
                    ],
                }
            ],
            tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
        )

        logger.info(f"[EVAL {job_id}] Claude responded, parsing...")

        # Step 4: Parse evaluation from response
        logger.info(f"[EVAL {job_id}] [STEP 4/4] Parsing response...")

        evaluation = None

        for block in response.content:
            if block.type == "text":
                try:
                    import json
                    evaluation = json.loads(block.text)
                    logger.info(f"[EVAL {job_id}] Parsed evaluation: score={evaluation.get('score')}")
                    break
                except Exception:
                    # Try to extract JSON from text
                    import re
                    json_match = re.search(r'\{[\s\S]*"score"[\s\S]*\}', block.text)
                    if json_match:
                        try:
                            evaluation = json.loads(json_match.group(0))
                            logger.info(f"[EVAL {job_id}] Parsed evaluation from regex")
                            break
                        except Exception:
                            pass

        # Fallback evaluation if parsing fails
        if not evaluation:
            logger.warning(f"[EVAL {job_id}] Could not parse response, using fallback")
            evaluation = {
                "score": 70,
                "completeness": 28,
                "accuracy": 28,
                "formatting": 14,
                "projectsFound": project_count,
                "projectsExpected": project_count,
                "issues": ["Could not parse Claude evaluation response"],
                "accuracyIssues": [],
                "emptyFields": [],
                "recommendation": "pass",
            }

        # Cleanup
        if anthropic_file_id:
            await delete_anthropic_file(client, anthropic_file_id)

        logger.info(f"[EVAL {job_id}] Evaluation complete. Score: {evaluation['score']}")

        return evaluation

    except Exception as e:
        # Cleanup on error
        if anthropic_file_id:
            await delete_anthropic_file(client, anthropic_file_id)
        raise e
