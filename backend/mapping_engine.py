"""
Mapping engine for field mapping Q&A.
"""

import json
import logging
import re
from typing import Any, Optional

import anthropic

from config import get_settings
import database as db

logger = logging.getLogger(__name__)

# Available AirSaas API fields
AVAILABLE_AIRSAAS_FIELDS = [
    # Basic project info
    {"id": "project.name", "label": "Project Name", "description": "The name of the project"},
    {"id": "project.short_id", "label": "Project Short ID", "description": "Short identifier like AQM-P8"},
    {"id": "project.description_text", "label": "Project Description", "description": "Project description as plain text"},
    {"id": "project.description", "label": "Project Description (Rich)", "description": "Project description with formatting"},

    # Status fields
    {"id": "project.status", "label": "Project Status", "description": "Current status (in_progress, finished, etc.)"},
    {"id": "project.mood", "label": "Project Mood", "description": "Mood indicator (good, complicated, blocked, etc.)"},
    {"id": "project.risk", "label": "Project Risk", "description": "Risk level (low, medium, high)"},

    # Owner info
    {"id": "project.owner.name", "label": "Owner Full Name", "description": "Project owner full name"},
    {"id": "project.owner.given_name", "label": "Owner First Name", "description": "Project owner first name"},
    {"id": "project.owner.family_name", "label": "Owner Last Name", "description": "Project owner last name"},
    {"id": "project.owner.initials", "label": "Owner Initials", "description": "Project owner initials"},

    # Dates
    {"id": "project.start_date", "label": "Start Date", "description": "Project start date"},
    {"id": "project.end_date", "label": "End Date", "description": "Project end date"},

    # Budget
    {"id": "project.budget_capex", "label": "Budget CAPEX", "description": "Capital expenditure budget"},
    {"id": "project.budget_opex", "label": "Budget OPEX", "description": "Operational expenditure budget"},
    {"id": "project.budget_capex_used", "label": "Budget CAPEX Used", "description": "Capital expenditure used"},
    {"id": "project.budget_opex_used", "label": "Budget OPEX Used", "description": "Operational expenditure used"},

    # Program
    {"id": "project.program.name", "label": "Program Name", "description": "Associated program name"},
    {"id": "project.program.short_id", "label": "Program ID", "description": "Program short identifier"},

    # Progress and effort
    {"id": "project.progress", "label": "Progress", "description": "Project progress percentage"},
    {"id": "project.milestone_progress", "label": "Milestone Progress", "description": "Milestone completion progress"},
    {"id": "project.effort", "label": "Planned Effort", "description": "Planned effort value"},
    {"id": "project.effort_used", "label": "Effort Used", "description": "Actual effort consumed"},

    # Arrays
    {"id": "milestones", "label": "Milestones", "description": "Array of milestones with dates and status"},
    {"id": "members", "label": "Project Members", "description": "Array of project team members"},
    {"id": "efforts", "label": "Team Efforts", "description": "Effort entries by team/period"},
    {"id": "budget_values", "label": "Budget Values", "description": "Budget value entries"},
    {"id": "attention_points", "label": "Attention Points", "description": "Items requiring attention"},
    {"id": "decisions", "label": "Decisions", "description": "Project decisions with status"},

    # Other
    {"id": "project.goals", "label": "Project Goals", "description": "Array of project goals"},
    {"id": "project.teams", "label": "Project Teams", "description": "Array of associated teams"},
    {"id": "project.importance", "label": "Importance", "description": "Project importance level"},
    {"id": "project.gain_text", "label": "Expected Gains", "description": "Expected gains/benefits text"},

    # Metadata
    {"id": "_metadata.name", "label": "Project Name (Meta)", "description": "Project name from metadata"},
    {"id": "_metadata.short_id", "label": "Project ID (Meta)", "description": "Short ID from metadata"},

    # Skip option
    {"id": "none", "label": "No mapping (skip)", "description": "Leave this field empty"},
]

QUESTION_PROMPT = """You are helping map PowerPoint template fields to AirSaas project data fields.

Given a template field and the available AirSaas fields, suggest the best matches.

Template field to map:
- Name: {field_name}
- Placeholder text: {placeholder_text}
- Data type expected: {data_type}
- Location in slide: {location}

Available AirSaas fields:
{available_fields}

Respond with a JSON object containing:
1. The question to ask the user (in a friendly, clear way)
2. 2-4 suggested options ordered by relevance (most relevant first)
3. Your confidence level (high, medium, low)

Format:
{{
  "question": "Which data should fill the '{field_name}' field?",
  "options": [
    {{ "id": "project.name", "label": "Project Name", "confidence": "high" }},
    {{ "id": "project.short_id", "label": "Project Short ID", "confidence": "medium" }}
  ],
  "reasoning": "Brief explanation of why these options were suggested",
  "confidence": "high|medium|low"
}}"""


async def get_next_mapping_question(
    session_id: str,
    action: str,
    answer: Optional[str] = None,
) -> dict[str, Any]:
    """
    Get the next mapping question or process an answer.

    Args:
        session_id: Session ID
        action: "next" to get next question, "answer" to submit answer
        answer: The user's answer (when action="answer")

    Returns:
        Response with question or completion status
    """
    settings = get_settings()
    supabase = db.get_supabase()

    # Get session with template analysis
    session = db.get_session(session_id)
    if not session:
        raise Exception("Session not found")

    # Get session data including template_analysis and mapping_state
    result = supabase.table("sessions").select("*").eq("id", session_id).single().execute()
    if not result.data:
        raise Exception("Session not found")

    session_data = result.data
    template_analysis = session_data.get("template_analysis")

    if not template_analysis or not template_analysis.get("slides"):
        raise Exception("Template analysis not found. Please analyze the template first.")

    # Get or initialize mapping state
    mapping_state = session_data.get("mapping_state") or {
        "fields": [],
        "currentIndex": 0,
        "mappings": {},
    }

    # If starting fresh, extract all fields from analysis
    if not mapping_state["fields"]:
        all_fields = []
        for slide in template_analysis["slides"]:
            for field in slide.get("fields", []):
                all_fields.append({
                    **field,
                    "slide_number": slide["slide_number"],
                })
        mapping_state["fields"] = all_fields
        mapping_state["currentIndex"] = 0
        mapping_state["mappings"] = {}

    # Handle answer from previous question
    if action == "answer" and answer:
        current_field = mapping_state["fields"][mapping_state["currentIndex"]]
        mapping_state["mappings"][current_field["id"]] = answer
        mapping_state["currentIndex"] += 1

    # Save updated mapping state
    supabase.table("sessions").update({
        "mapping_state": mapping_state,
    }).eq("id", session_id).execute()

    # Check if all fields have been mapped
    if mapping_state["currentIndex"] >= len(mapping_state["fields"]):
        # Generate final mapping JSON
        final_mapping = {
            "slides": {},
            "missing_fields": [],
        }

        for slide in template_analysis["slides"]:
            slide_key = f"slide_{slide['slide_number']}"
            final_mapping["slides"][slide_key] = {}

            for field in slide.get("fields", []):
                mapped_source = mapping_state["mappings"].get(field["id"])
                if mapped_source and mapped_source != "none":
                    final_mapping["slides"][slide_key][field["id"]] = {
                        "source": mapped_source,
                        "status": "ok",
                    }
                else:
                    final_mapping["missing_fields"].append(field["id"])

        # Save final mapping
        mapping = db.get_mapping_by_session(session_id)
        if mapping:
            db.update_mapping(mapping.id, {"mapping_json": final_mapping})
            mapping_id = mapping.id
        else:
            new_mapping = db.create_mapping(
                session_id=session_id,
                mapping_json=final_mapping,
                template_path=session_data.get("template_path"),
            )
            mapping_id = new_mapping.id

        return {
            "complete": True,
            "mappingJson": final_mapping,
            "mappingId": mapping_id,
            "totalFields": len(mapping_state["fields"]),
            "mappedFields": len([k for k, v in mapping_state["mappings"].items() if v != "none"]),
        }

    # Get current field to ask about
    current_field = mapping_state["fields"][mapping_state["currentIndex"]]

    # Use Claude to generate smart suggestions
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    available_fields_str = "\n".join([
        f"- {f['id']}: {f['label']} - {f['description']}"
        for f in AVAILABLE_AIRSAAS_FIELDS
    ])

    prompt = QUESTION_PROMPT.format(
        field_name=current_field["name"],
        placeholder_text=current_field.get("placeholder_text", "N/A"),
        data_type=current_field.get("data_type", "text"),
        location=current_field.get("location", "body"),
        available_fields=available_fields_str,
    )

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    # Extract text response
    suggestion_text = ""
    for block in response.content:
        if block.type == "text":
            suggestion_text += block.text

    # Parse JSON from response
    suggestion = None
    import re
    import json

    json_match = re.search(r'\{[\s\S]*\}', suggestion_text)
    if json_match:
        try:
            suggestion = json.loads(json_match.group(0))
        except Exception:
            pass

    # Default suggestion if parsing fails
    if not suggestion:
        suggestion = {
            "question": f"Which AirSaas field should map to \"{current_field['name']}\"?",
            "options": [
                {"id": "project.name", "label": "Project Name", "confidence": "medium"},
                {"id": "project.description", "label": "Project Description", "confidence": "medium"},
                {"id": "none", "label": "Skip this field", "confidence": "low"},
            ],
            "reasoning": "Default suggestions provided",
            "confidence": "low",
        }

    # Full list of options
    all_options = [
        {"id": f["id"], "label": f["label"], "description": f["description"]}
        for f in AVAILABLE_AIRSAAS_FIELDS
    ]

    return {
        "complete": False,
        "currentIndex": mapping_state["currentIndex"],
        "totalFields": len(mapping_state["fields"]),
        "field": current_field,
        "question": suggestion["question"],
        "suggestedOptions": suggestion["options"],
        "allOptions": all_options,
        "reasoning": suggestion.get("reasoning"),
        "confidence": suggestion.get("confidence"),
    }


# =============================================================================
# Batch Mapping Functions
# =============================================================================

BATCH_MAPPING_PROMPT = """You are helping map PowerPoint template fields to AirSaas project data fields.

## Template Fields to Map
{template_fields}

## Available AirSaas Fields
{available_fields}

## Sample Project Data (for context)
{sample_data}

## Task
For EACH template field, suggest the best matching AirSaas field based on:
1. Field name semantics
2. Data type compatibility
3. The sample data values

Respond with a JSON array containing one object per template field:
```json
[
  {{
    "field_id": "the template field id",
    "suggested_mapping": "the AirSaas field id (e.g., project.name)",
    "confidence": "high|medium|low",
    "reasoning": "brief explanation"
  }},
  ...
]
```

Important:
- Use "none" as suggested_mapping if no good match exists
- Be precise with the field_id - use exactly the same id from the template fields
- Consider data types: dates should map to date fields, arrays to array fields, etc.
"""


def _truncate_sample_data(project_data: dict[str, Any], max_chars: int = 3000) -> dict[str, Any]:
    """Truncate sample data to fit within token limits."""
    # Keep only essential fields for context
    truncated = {}
    
    if "project" in project_data:
        project = project_data["project"]
        truncated["project"] = {
            k: v for k, v in project.items()
            if k in [
                "name", "short_id", "description_text", "status", "mood", "risk",
                "start_date", "end_date", "progress", "milestone_progress",
                "budget_capex", "budget_opex", "importance"
            ]
        }
        # Add owner info if present
        if "owner" in project and isinstance(project["owner"], dict):
            truncated["project"]["owner"] = {
                k: v for k, v in project["owner"].items()
                if k in ["name", "given_name", "family_name", "initials"]
            }
        # Add program info if present
        if "program" in project and isinstance(project["program"], dict):
            truncated["project"]["program"] = {
                k: v for k, v in project["program"].items()
                if k in ["name", "short_id"]
            }
    
    # Include first few items of arrays for context
    for key in ["milestones", "decisions", "attention_points", "members"]:
        if key in project_data and isinstance(project_data[key], list):
            items = project_data[key][:3]  # First 3 items
            if items:
                truncated[key] = items
    
    # Convert to string and check size
    result_str = json.dumps(truncated, default=str)
    if len(result_str) > max_chars:
        # Further truncate if needed
        truncated = {"project": truncated.get("project", {})}
        
    return truncated


async def generate_batch_suggestions(
    session_id: str,
) -> dict[str, Any]:
    """
    Generate mapping suggestions for ALL template fields in one call.
    
    Returns:
        {
            "fields": [...],  # All fields with their suggestions
            "allOptions": [...],  # All available AirSaas fields
        }
    """
    settings = get_settings()
    supabase = db.get_supabase()
    
    # Get session data
    result = supabase.table("sessions").select("*").eq("id", session_id).single().execute()
    if not result.data:
        raise Exception("Session not found")
    
    session_data = result.data
    template_analysis = session_data.get("template_analysis")
    fetched_projects_data = session_data.get("fetched_projects_data")
    
    if not template_analysis or not template_analysis.get("slides"):
        raise Exception("Template analysis not found. Please analyze the template first.")
    
    # Extract all fields from template analysis
    all_fields = []
    for slide in template_analysis["slides"]:
        for field in slide.get("fields", []):
            all_fields.append({
                **field,
                "slide_number": slide["slide_number"],
            })
    
    if not all_fields:
        raise Exception("No fields found in template analysis")
    
    # Get sample project data for context
    sample_data = {}
    if fetched_projects_data and fetched_projects_data.get("projects"):
        first_project = fetched_projects_data["projects"][0]
        sample_data = _truncate_sample_data(first_project)
    
    # Format template fields for prompt
    template_fields_str = json.dumps([
        {
            "id": f["id"],
            "name": f["name"],
            "data_type": f.get("data_type", "text"),
            "placeholder_text": f.get("placeholder_text", ""),
            "location": f.get("location", "body"),
            "slide_number": f.get("slide_number"),
        }
        for f in all_fields
    ], indent=2)
    
    # Format available fields
    available_fields_str = "\n".join([
        f"- {f['id']}: {f['label']} - {f['description']}"
        for f in AVAILABLE_AIRSAAS_FIELDS
    ])
    
    # Format sample data
    sample_data_str = json.dumps(sample_data, indent=2, default=str) if sample_data else "No sample data available"
    
    # Build prompt
    prompt = BATCH_MAPPING_PROMPT.format(
        template_fields=template_fields_str,
        available_fields=available_fields_str,
        sample_data=sample_data_str,
    )
    
    # Call Claude
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    
    logger.info(f"Generating batch suggestions for {len(all_fields)} fields...")
    
    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    
    # Extract text response
    suggestion_text = ""
    for block in response.content:
        if block.type == "text":
            suggestion_text += block.text
    
    # Parse JSON array from response
    suggestions = []
    json_match = re.search(r'\[[\s\S]*\]', suggestion_text)
    if json_match:
        try:
            suggestions = json.loads(json_match.group(0))
        except Exception as e:
            logger.error(f"Failed to parse suggestions JSON: {e}")
    
    # Build suggestions map
    suggestions_map = {s["field_id"]: s for s in suggestions}
    
    # Merge suggestions with fields
    fields_with_suggestions = []
    for field in all_fields:
        suggestion = suggestions_map.get(field["id"], {})
        fields_with_suggestions.append({
            **field,
            "suggested_mapping": suggestion.get("suggested_mapping", "none"),
            "confidence": suggestion.get("confidence", "low"),
            "reasoning": suggestion.get("reasoning", ""),
        })
    
    # All available options
    all_options = [
        {"id": f["id"], "label": f["label"], "description": f["description"]}
        for f in AVAILABLE_AIRSAAS_FIELDS
    ]
    
    logger.info(f"Generated suggestions for {len(fields_with_suggestions)} fields")
    
    return {
        "fields": fields_with_suggestions,
        "allOptions": all_options,
        "totalFields": len(fields_with_suggestions),
    }


async def save_batch_mappings(
    session_id: str,
    mappings: dict[str, str],
    template_path: Optional[str] = None,
) -> dict[str, Any]:
    """
    Save all mappings at once.
    
    Args:
        session_id: Session ID
        mappings: Dict of { field_id: source_id }
        template_path: Optional template path
        
    Returns:
        { mappingId: str, mappedFields: int, skippedFields: int }
    """
    supabase = db.get_supabase()
    
    # Get session data for template_analysis
    result = supabase.table("sessions").select("*").eq("id", session_id).single().execute()
    if not result.data:
        raise Exception("Session not found")
    
    session_data = result.data
    template_analysis = session_data.get("template_analysis")
    
    if not template_analysis or not template_analysis.get("slides"):
        raise Exception("Template analysis not found")
    
    # Build final mapping JSON structure
    final_mapping = {
        "slides": {},
        "missing_fields": [],
    }
    
    for slide in template_analysis["slides"]:
        slide_key = f"slide_{slide['slide_number']}"
        final_mapping["slides"][slide_key] = {}
        
        for field in slide.get("fields", []):
            mapped_source = mappings.get(field["id"])
            if mapped_source and mapped_source != "none":
                final_mapping["slides"][slide_key][field["id"]] = {
                    "source": mapped_source,
                    "status": "ok",
                }
            else:
                final_mapping["missing_fields"].append(field["id"])
    
    # Get template path from session if not provided
    if not template_path:
        template_path = session_data.get("template_path", "")
    
    # Save or update mapping
    existing_mapping = db.get_mapping_by_session(session_id)
    if existing_mapping:
        db.update_mapping(existing_mapping.id, {"mapping_json": final_mapping})
        mapping_id = existing_mapping.id
    else:
        new_mapping = db.create_mapping(
            session_id=session_id,
            mapping_json=final_mapping,
            template_path=template_path,
        )
        mapping_id = new_mapping.id
    
    # Update session step
    db.update_session(session_id, {"current_step": "long_text_options"})
    
    mapped_count = len([v for v in mappings.values() if v and v != "none"])
    skipped_count = len([v for v in mappings.values() if not v or v == "none"])
    
    logger.info(f"Saved batch mappings: {mapped_count} mapped, {skipped_count} skipped")
    
    return {
        "success": True,
        "mappingId": mapping_id,
        "mappedFields": mapped_count,
        "skippedFields": skipped_count,
    }
