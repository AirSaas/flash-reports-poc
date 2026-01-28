"""
Data Population Service

Populates HTML templates with actual project data using Claude to:
1. Understand the mapping between template fields and project data
2. Generate the populated HTML with correct data placement
3. Creatively expand templates for multiple projects while preserving design
"""

import anthropic
import json
import re
from typing import Dict, List, Any, Optional

from app.config import ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS


# Initialize Anthropic client
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def fix_mojibake(text: str) -> str:
    """
    Fix mojibake (UTF-8 misinterpreted as Latin-1/Windows-1252) in text.
    This is common when data comes from external APIs with encoding issues.
    """
    if not isinstance(text, str):
        return text

    # Common mojibake patterns - using Unicode escape sequences
    fixes = [
        # Bullets - mojibake patterns
        ("\u00e2\u20ac\u00a2", "*"),      # â€¢ -> • bullet
        ("\u00e2\u0096\u00aa", "*"),      # â–ª -> ▪ small square
        ("\u00e2\u0097\u00a6", "*"),      # â—¦ -> ◦ white bullet
        ("\u00e2\u0097\u2039", "*"),      # â—‹ -> ○ white circle
        ("\u00e2\u0097", "*"),            # â— -> ● black circle prefix
        # Dashes - mojibake patterns
        ("\u00e2\u20ac\u201c", "-"),      # â€" -> – en-dash
        ("\u00e2\u20ac\u201d", "-"),      # â€" -> — em-dash
        # Quotes - mojibake patterns
        ("\u00e2\u20ac\u02dc", "'"),      # â€˜ -> ' left single quote
        ("\u00e2\u20ac\u2122", "'"),      # â€™ -> ' right single quote
        ("\u00e2\u20ac\u0153", '"'),      # â€œ -> " left double quote
        ("\u00e2\u20ac\u009d", '"'),      # â€ -> " right double quote
        # Arrows - mojibake patterns
        ("\u00e2\u2020\u2019", "->"),     # â†' -> → right arrow
        ("\u00e2\u2020\u0090", "<-"),     # â† -> ← left arrow
        # Spaces - mojibake
        ("\u00c2\u00a0", " "),            # Â  -> non-breaking space
        # French/Spanish accents - mojibake (Ã + second byte)
        ("\u00c3\u00a9", "e"),            # Ã© -> é
        ("\u00c3\u00a8", "e"),            # Ã¨ -> è
        ("\u00c3\u00aa", "e"),            # Ãª -> ê
        ("\u00c3\u00a0", "a"),            # Ã  -> à
        ("\u00c3\u00a2", "a"),            # Ã¢ -> â
        ("\u00c3\u00a1", "a"),            # Ã¡ -> á
        ("\u00c3\u00ae", "i"),            # Ã® -> î
        ("\u00c3\u00af", "i"),            # Ã¯ -> ï
        ("\u00c3\u00ad", "i"),            # Ã­ -> í
        ("\u00c3\u00b4", "o"),            # Ã´ -> ô
        ("\u00c3\u00b3", "o"),            # Ã³ -> ó
        ("\u00c3\u00b9", "u"),            # Ã¹ -> ù
        ("\u00c3\u00bb", "u"),            # Ã» -> û
        ("\u00c3\u00ba", "u"),            # Ãº -> ú
        ("\u00c3\u00bc", "u"),            # Ã¼ -> ü
        ("\u00c3\u00a7", "c"),            # Ã§ -> ç
        ("\u00c3\u00b1", "n"),            # Ã± -> ñ
        ("\u00c3\u00a4", "a"),            # Ã¤ -> ä
        ("\u00c3\u00b6", "o"),            # Ã¶ -> ö
        ("\u00c5\u0093", "oe"),           # Å" -> œ
        ("\u00c3\u0178", "ss"),           # ÃŸ -> ß
        # Spanish punctuation
        ("\u00c2\u00bf", "?"),            # Â¿ -> ¿
        ("\u00c2\u00a1", "!"),            # Â¡ -> ¡
    ]

    result = text
    for bad, good in fixes:
        result = result.replace(bad, good)

    return result


def clean_project_data(data: Any) -> Any:
    """
    Recursively clean mojibake from project data (dicts, lists, strings).
    """
    if isinstance(data, str):
        return fix_mojibake(data)
    elif isinstance(data, dict):
        return {k: clean_project_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [clean_project_data(item) for item in data]
    else:
        return data


def get_nested_value(data: Dict[str, Any], path: str) -> Any:
    """
    Get a value from nested dictionary using dot notation path.

    Examples:
        get_nested_value(data, "project.name") → data["project"]["name"]
        get_nested_value(data, "milestones") → data["milestones"]
    """
    keys = path.split('.')
    value = data

    for key in keys:
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit():
            idx = int(key)
            value = value[idx] if idx < len(value) else None
        else:
            return None

        if value is None:
            return None

    return value


def apply_mapping_to_project(
    project_data: Dict[str, Any],
    mapping_json: Dict[str, Any],
    template_fields: List[str]
) -> Dict[str, str]:
    """
    Apply the mapping configuration to extract values for each template field.

    Args:
        project_data: The fetched project data from AirSaas
        mapping_json: The mapping configuration from the mapping step
        template_fields: List of field names found in the HTML template

    Returns:
        Dictionary mapping field_name → actual_value
    """
    field_values = {}

    # The mapping_json structure from mapping-batch-submit:
    # {
    #   "slides": {
    #     "slide_1": {
    #       "field_id": { "source": "project.name", "status": "ok" }
    #     }
    #   },
    #   "missing_fields": []
    # }

    # Build a flat mapping from field_id to source path
    field_to_source = {}

    if "slides" in mapping_json:
        for slide_key, slide_fields in mapping_json["slides"].items():
            for field_id, field_config in slide_fields.items():
                if isinstance(field_config, dict) and field_config.get("source"):
                    field_to_source[field_id] = field_config["source"]

    # For each template field, try to find its value
    for field_name in template_fields:
        # Check if we have a mapping for this field
        source_path = field_to_source.get(field_name)

        if source_path and source_path != "none":
            value = get_nested_value(project_data, source_path)
            if value is not None:
                # Convert value to string representation
                if isinstance(value, list):
                    # For arrays, format as bullet points or comma-separated
                    field_values[field_name] = format_array_value(value)
                elif isinstance(value, dict):
                    # For objects, use a sensible string representation
                    field_values[field_name] = format_dict_value(value)
                else:
                    field_values[field_name] = str(value)
            else:
                field_values[field_name] = ""
        else:
            # No mapping found, leave empty or use placeholder
            field_values[field_name] = ""

    return field_values


def format_array_value(arr: List[Any], max_items: int = 5) -> str:
    """Format an array value for display."""
    if not arr:
        return ""

    items = arr[:max_items]
    formatted = []

    for item in items:
        if isinstance(item, dict):
            # Try common name fields
            name = item.get("name") or item.get("title") or item.get("label")
            if name:
                formatted.append(str(name))
            else:
                formatted.append(str(item))
        else:
            formatted.append(str(item))

    return ", ".join(formatted)


def format_dict_value(d: Dict[str, Any]) -> str:
    """Format a dictionary value for display."""
    # Try common name fields
    name = d.get("name") or d.get("title") or d.get("label") or d.get("full_name")
    if name:
        return str(name)

    # Fallback to first string value
    for key, value in d.items():
        if isinstance(value, str):
            return value

    return str(d)


def simple_populate_html(html_template: str, field_values: Dict[str, str]) -> str:
    """
    Simple string replacement to populate HTML template.

    Replaces all {{field_name}} with corresponding values.
    """
    result = html_template

    for field_name, value in field_values.items():
        placeholder = f"{{{{{field_name}}}}}"
        result = result.replace(placeholder, value or "")

    # Remove any remaining unmatched placeholders
    result = re.sub(r'\{\{[\w_]+\}\}', '', result)

    return result


# Advanced prompt for intelligent HTML population
POPULATION_PROMPT = """<role>
You are an expert presentation designer who populates HTML slide templates with project data.
You create professional, visually balanced presentations that effectively communicate project information.
</role>

<critical_css_rules>
ABSOLUTE CSS RESTRICTIONS - NEVER VIOLATE:
1. DO NOT use flexbox (display: flex) - FORBIDDEN
2. DO NOT use CSS Grid (display: grid) - FORBIDDEN
3. DO NOT add ANY new CSS rules to the <style> block
4. DO NOT add inline styles that change layout (no style="display:..." etc)
5. COPY the template's <style> block EXACTLY - character by character
6. The template uses position: absolute - KEEP IT THAT WAY
</critical_css_rules>

<what_you_CAN_do>
You ARE ALLOWED to make these adjustments ONLY via inline styles on individual elements:
1. Reduce font-size on long titles so they fit (e.g., style="font-size: 18px;")
2. Add text-overflow: ellipsis for text that might overflow
3. Adjust line-height if text is cramped
4. These are the ONLY inline style changes permitted
</what_you_CAN_do>

<html_template>
{html_template}
</html_template>

<template_fields>
{template_fields}
</template_fields>

<project_data>
```json
{project_data}
```
</project_data>

<mapping_configuration>
```json
{mapping_json}
```
</mapping_configuration>

<slide_structure_spec>
REPORT STRUCTURE (based on Flash Report specification):
The generated HTML report should follow this structure:

FOR SINGLE PROJECT:
- The template defines the slide types (Card, Progress, Planning, etc.)
- Populate ALL slides with the project's data

FOR MULTI-PROJECT REPORTS:
- Slide 1: SUMMARY SLIDE - Overview of all projects with status/mood indicators
- Slides 2-N: PROJECT SLIDES - Template structure repeated for each project
- Final Slide: DATA NOTES - List any fields that could not be populated

COMMON SLIDE TYPES (per project, as defined by template):
1. PROJECT CARD: Name, Budget, Achievements, Status, Mood/Weather, Risk level, Key dates
2. PROGRESS SLIDE: Completion percentage, KPIs, Key metrics
3. PLANNING SLIDE: Milestones timeline, Team efforts, Resource allocation

DATA FIELD PRIORITIES (what to show when available):
- Project identification: name, short_id, program
- Status indicators: status, mood/weather, risk level
- Financial: budget (initial, current, EAC), expenses
- Progress: completion %, milestones status
- Timeline: start_date, end_date, key milestone dates
- People: owner, manager, team members
- Achievements: recent accomplishments, decisions made
- Risks/Issues: attention points, blockers
</slide_structure_spec>

<population_task>
1. COPY the entire HTML template structure exactly
2. For each {{field_name}} placeholder:
   a. Find the mapping: mapping_json tells you which data field to use
   b. Get the value from project_data using the mapped path
   c. Replace {{field_name}} with the actual value

3. TEXT FITTING - Critical:
   - If a title/text is too long for its container, REDUCE the font-size inline
   - Example: <span style="font-size: 14px;">Very Long Project Name Here</span>
   - Titles should NEVER overflow or get cut off
   - Use "..." truncation for descriptions that are too long

4. ABSOLUTELY NO EMPTY SLIDES OR BLANK FIELDS - THIS IS CRITICAL:
   - EVERY slide must have meaningful, visible content
   - EVERY text field must be filled with real data
   - If a {{field_name}} has no direct mapping, FIND relevant data from project_data to fill it
   - Look for related fields: name, title, description, status, dates, owner, budget, progress, etc.
   - If truly no data exists, use sensible placeholders like "N/A", "-", or "Not specified"
   - NEVER leave a visible text area empty or with just whitespace
   - A slide with blank content is UNACCEPTABLE - always populate with something meaningful

5. INTELLIGENT DATA FILLING (when no direct mapping exists):
   - Analyze ALL available data in project_data
   - Match fields intelligently: "project_title" can fill a "name" placeholder
   - Use context: a "description" field can fill "summary", "overview", "details" placeholders
   - Dates: use start_date, end_date, created_at, updated_at as appropriate
   - Numbers: use budget, progress, completion_rate, etc.
   - Status fields: use status, phase, state interchangeably
   - Owner/Manager: use owner, manager, lead, responsible, assignee

6. DATA FORMATTING:
   - Dates: "Jan 15, 2024" or "15/01/2024"
   - Percentages: "85%" (include % symbol)
   - Currency: "$150,000" or "150,000 EUR"
   - Status: Capitalize properly ("In Progress", "Completed", "On Hold")
   - Numbers: Use thousand separators (1,500 not 1500)

7. LISTS AND BULLET POINTS - CRITICAL:
   - ALWAYS use proper HTML structure for lists: <ul><li>Item</li></ul>
   - NEVER output raw bullet characters like "* Item 1 * Item 2" in plain text
   - For milestones, tasks, or any list data, convert to proper HTML:
     WRONG: "* Milestone 1 * Milestone 2 * Milestone 3"
     CORRECT: <ul><li>Milestone 1</li><li>Milestone 2</li><li>Milestone 3</li></ul>
   - Style lists appropriately within their containers

8. VISUAL BALANCE:
   - Text should not overlap with other elements
   - Maintain readable spacing
   - Keep the professional look of the template
</population_task>

<output>
Return ONLY the complete populated HTML document.
- No explanations
- No markdown code blocks
- No ```html wrapper
- Just raw HTML starting with <!DOCTYPE html>
</output>"""


def populate_html_with_claude(
    html_template: str,
    project_data: Dict[str, Any],
    mapping_json: Dict[str, Any]
) -> str:
    """
    Use Claude Opus 4.5 to intelligently populate the HTML template with project data.

    This approach is sophisticated - Claude understands the context and can:
    1. Handle complex data transformations
    2. Format data appropriately for each field type
    3. Handle missing data gracefully
    4. Maintain visual consistency
    """
    # Clean project data to fix any mojibake encoding issues
    cleaned_project_data = clean_project_data(project_data)

    # First, extract template fields
    template_fields = list(set(re.findall(r'\{\{(\w+)\}\}', html_template)))

    # Build the prompt
    prompt = POPULATION_PROMPT.format(
        html_template=html_template,
        template_fields=json.dumps(template_fields, indent=2),
        project_data=json.dumps(cleaned_project_data, indent=2, ensure_ascii=False),
        mapping_json=json.dumps(mapping_json, indent=2)
    )

    # Use Claude Opus 4.5 with streaming
    html_content = ""
    token_count = 0

    print(f"         [populate] Prompt size: {len(prompt)} chars")
    print(f"         [populate] Model: {CLAUDE_MODEL}, Max tokens: {CLAUDE_MAX_TOKENS}")
    print(f"         [populate] Starting Claude API call...", flush=True)

    import time as _time
    api_start = _time.time()

    with client.messages.stream(
        model=CLAUDE_MODEL,  # claude-opus-4-5-20251101
        max_tokens=CLAUDE_MAX_TOKENS,
        temperature=0.1,  # Minimal creativity for smart data presentation
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    ) as stream:
        for text in stream.text_stream:
            html_content += text
            token_count += 1
            if token_count % 500 == 0:
                elapsed = _time.time() - api_start
                print(f"\n         [stream] {token_count} chunks, {elapsed:.1f}s elapsed, HTML: {len(html_content)} chars", flush=True)

    api_elapsed = _time.time() - api_start
    print(f"\n         [populate] Completed in {api_elapsed:.1f}s, chunks: {token_count}, HTML: {len(html_content)} chars", flush=True)

    # Clean up - extract just the HTML if wrapped in code blocks
    if "```html" in html_content:
        match = re.search(r'```html\s*([\s\S]*?)\s*```', html_content)
        if match:
            html_content = match.group(1)
    elif "```" in html_content:
        match = re.search(r'```\s*([\s\S]*?)\s*```', html_content)
        if match:
            html_content = match.group(1)

    # Fix any mojibake in the generated HTML output
    return fix_mojibake(html_content.strip())


# Advanced prompt for multi-project HTML generation
MULTI_PROJECT_PROMPT = """<role>
You are an expert presentation designer creating a multi-project report.
You will generate slides for MULTIPLE projects, each with the same professional design but different data.
Your presentations are visually polished, well-balanced, and effectively communicate project information.
</role>

<critical_css_rules>
ABSOLUTE CSS RESTRICTIONS - NEVER VIOLATE:
1. DO NOT use flexbox (display: flex) - FORBIDDEN
2. DO NOT use CSS Grid (display: grid) - FORBIDDEN
3. DO NOT add ANY new CSS rules to the <style> block
4. COPY the template's <style> block EXACTLY - character by character
5. The template uses position: absolute - KEEP IT THAT WAY
</critical_css_rules>

<what_you_CAN_do>
You ARE ALLOWED to make these adjustments ONLY via inline styles on individual elements:
1. Reduce font-size on long titles so they fit (e.g., style="font-size: 16px;")
2. Add text-overflow: ellipsis for overflowing text
3. Adjust line-height if needed for readability
4. These are the ONLY inline style changes permitted
</what_you_CAN_do>

<original_template>
{html_template}
</original_template>

<projects_data>
Here is the data for ALL projects. Create slides for EACH project:
```json
{projects_data}
```
</projects_data>

<mapping_configuration>
This tells you which template field maps to which data path:
```json
{mapping_json}
```
</mapping_configuration>

<slide_structure_spec>
MULTI-PROJECT REPORT STRUCTURE (Flash Report specification):

SLIDE SEQUENCE:
1. SUMMARY SLIDE (Slide 1):
   - Overview table/grid of ALL projects
   - Show: Project name, Status, Mood/Weather indicator, Key metric
   - This gives executives a quick portfolio view

2. PROJECT SLIDES (Slides 2 to N):
   - For EACH project, generate the complete template slide set
   - Template typically includes: Card, Progress, Planning slides
   - Each project gets its own complete set of slides

3. DATA NOTES SLIDE (Final slide):
   - List any fields that could not be populated
   - Show which projects had missing data
   - This is for transparency about data gaps

COMMON SLIDE TYPES (per project):
1. PROJECT CARD: Name, Budget, Achievements, Status, Mood/Weather, Risk, Dates
2. PROGRESS SLIDE: Completion %, KPIs, Metrics, Progress bars
3. PLANNING SLIDE: Milestones timeline, Team efforts table, Resource allocation

DATA PRIORITIES (populate these fields first):
- Identity: project name, short_id, program name
- Status: current status, mood/weather, risk level
- Financial: budget values (initial, current, EAC)
- Progress: completion percentage, milestone counts
- Timeline: start_date, end_date, next milestone
- People: owner name, manager, team size
- Key info: achievements, decisions, attention points
</slide_structure_spec>

<generation_task>
1. COPY the <style> block from the template EXACTLY - no modifications

2. CREATE SUMMARY SLIDE FIRST:
   - Generate a summary/overview slide listing ALL projects
   - Include: project name, status indicator, mood/weather, key metric
   - Use a table or card grid layout that fits the template style

3. FOR EACH PROJECT in projects_data, create a complete set of slides:
   a. Copy all slide <div>s from the template body
   b. Add attributes: data-project-index="N" data-project-name="Project Name"
   c. Replace ALL {{field_name}} placeholders with actual data from that project
   d. Use the mapping_configuration to find the correct data path for each field

4. TEXT FITTING - Critical for each slide:
   - Long titles: Reduce font-size inline (e.g., style="font-size: 14px;")
   - Long descriptions: Truncate with "..."
   - Text must NEVER overlap other elements
   - Text must NEVER overflow its container
   - Adjust font sizes to fit content properly

5. ABSOLUTELY NO EMPTY SLIDES OR BLANK FIELDS - THIS IS CRITICAL:
   - EVERY slide for EVERY project must have meaningful, visible content
   - EVERY text field must be filled with real data
   - If a {{field_name}} has no direct mapping, FIND relevant data from that project to fill it
   - Look for related fields: name, title, description, status, dates, owner, budget, progress, etc.
   - If truly no data exists, use sensible placeholders like "N/A", "-", or "Not specified"
   - NEVER leave a visible text area empty or with just whitespace
   - A slide with blank content is UNACCEPTABLE - always populate with something meaningful

6. INTELLIGENT DATA FILLING (when no direct mapping exists):
   - Analyze ALL available data in each project
   - Match fields intelligently: "project_title" can fill a "name" placeholder
   - Use context: a "description" field can fill "summary", "overview", "details" placeholders
   - Dates: use start_date, end_date, created_at, updated_at as appropriate
   - Numbers: use budget, progress, completion_rate, etc.
   - Status fields: use status, phase, state interchangeably
   - Owner/Manager: use owner, manager, lead, responsible, assignee

7. DATA FORMATTING:
   - Dates: "Jan 15, 2024" format
   - Percentages: "85%" (always include %)
   - Currency: "$150,000" or "EUR 150,000"
   - Status: "In Progress", "Completed", "On Hold" (capitalized)
   - Numbers: Use thousand separators

8. LISTS AND BULLET POINTS - CRITICAL:
   - ALWAYS use proper HTML structure for lists: <ul><li>Item</li></ul>
   - NEVER output raw bullet characters like "* Item 1 * Item 2" in plain text
   - For milestones, tasks, or any list data, convert to proper HTML:
     WRONG: "* Milestone 1 * Milestone 2 * Milestone 3"
     CORRECT: <ul><li>Milestone 1</li><li>Milestone 2</li><li>Milestone 3</li></ul>
   - Style lists appropriately within their containers

9. VISUAL QUALITY per slide:
   - Professional appearance
   - Readable text sizes (minimum 10px)
   - Proper spacing between elements
   - Consistent formatting across all projects
   - Each project's slides should look as polished as the template

10. CONTENT DECISIONS:
    - Analyze what data is available for each project
    - Present the most relevant and important information
    - If a project has more data than fits, prioritize key metrics
    - Ensure consistency in what data appears across all projects

11. CREATE DATA NOTES SLIDE (at the end):
    - Add a final slide listing any fields that could not be populated
    - Group missing fields by project if applicable
    - This provides transparency about data gaps
</generation_task>

<output_structure>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Report</title>
    [EXACT COPY of template's <style> block]
</head>
<body>
    <!-- Project 1 slides -->
    <div class="slide" data-slide-number="1" data-project-index="0" data-project-name="...">...</div>
    <div class="slide" data-slide-number="2" data-project-index="0" data-project-name="...">...</div>

    <!-- Project 2 slides -->
    <div class="slide" data-slide-number="1" data-project-index="1" data-project-name="...">...</div>
    <div class="slide" data-slide-number="2" data-project-index="1" data-project-name="...">...</div>

    <!-- ... more projects ... -->
</body>
</html>
</output_structure>

<output>
Return ONLY the complete HTML document.
- No explanations or commentary
- No markdown code blocks (no ```html)
- Just raw HTML starting with <!DOCTYPE html>
The CSS must be IDENTICAL to the template. Only slide content changes.
</output>"""


def generate_multi_project_html(
    html_template: str,
    projects_data: List[Dict[str, Any]],
    mapping_json: Dict[str, Any],
    use_claude: bool = True
) -> str:
    """
    Generate HTML with slides for multiple projects using Claude Opus 4.5.

    Args:
        html_template: The HTML template with placeholders
        projects_data: List of project data dictionaries
        mapping_json: The mapping configuration
        use_claude: Whether to use Claude for population (vs simple replacement)

    Returns:
        Complete HTML with slides for all projects
    """
    if not projects_data:
        return html_template

    if not use_claude:
        # Fallback to simple replacement for each project
        return _simple_multi_project_generation(html_template, projects_data, mapping_json)

    # Clean all project data to fix any mojibake encoding issues
    cleaned_projects_data = [clean_project_data(proj) for proj in projects_data]

    # Use Claude Opus 4.5 for intelligent multi-project generation
    prompt = MULTI_PROJECT_PROMPT.format(
        html_template=html_template,
        projects_data=json.dumps(cleaned_projects_data, indent=2, ensure_ascii=False),
        mapping_json=json.dumps(mapping_json, indent=2)
    )

    html_content = ""
    token_count = 0

    print(f"         Generating slides for {len(projects_data)} projects...")
    print(f"         Template HTML size: {len(html_template)} chars")
    print(f"         Projects data size: {len(json.dumps(cleaned_projects_data))} chars")
    print(f"         Total prompt size: {len(prompt)} chars")
    print(f"         Model: {CLAUDE_MODEL}, Max tokens: {CLAUDE_MAX_TOKENS}")
    print(f"         Starting Claude API call...", flush=True)

    import time as _time
    api_start = _time.time()

    with client.messages.stream(
        model=CLAUDE_MODEL,  # claude-opus-4-5-20251101
        max_tokens=CLAUDE_MAX_TOKENS,
        temperature=0.15,  # Slight creativity for smart data presentation
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    ) as stream:
        for text in stream.text_stream:
            html_content += text
            token_count += 1
            if token_count % 500 == 0:
                elapsed = _time.time() - api_start
                print(f"\n         [stream] {token_count} chunks received, {elapsed:.1f}s elapsed, HTML size: {len(html_content)} chars", flush=True)

    api_elapsed = _time.time() - api_start
    print(f"\n         Claude API completed in {api_elapsed:.1f}s, total chunks: {token_count}, HTML size: {len(html_content)} chars", flush=True)

    # Clean up response
    if "```html" in html_content:
        match = re.search(r'```html\s*([\s\S]*?)\s*```', html_content)
        if match:
            html_content = match.group(1)
    elif "```" in html_content:
        match = re.search(r'```\s*([\s\S]*?)\s*```', html_content)
        if match:
            html_content = match.group(1)

    # Fix any mojibake in the generated HTML output
    return fix_mojibake(html_content.strip())


def _simple_multi_project_generation(
    html_template: str,
    projects_data: List[Dict[str, Any]],
    mapping_json: Dict[str, Any]
) -> str:
    """
    Simple fallback for multi-project generation without Claude.
    """
    template_fields = list(set(re.findall(r'\{\{(\w+)\}\}', html_template)))
    all_slides_html = []

    for idx, project_data in enumerate(projects_data):
        field_values = apply_mapping_to_project(project_data, mapping_json, template_fields)
        populated = simple_populate_html(html_template, field_values)

        # Extract slide content and add project attributes
        slide_match = re.search(r'<body[^>]*>([\s\S]*)</body>', populated)
        if slide_match:
            slides_content = slide_match.group(1)
            project_name = project_data.get("project", {}).get("name", f"Project {idx+1}")
            slides_content = re.sub(
                r'<div class="slide"',
                f'<div class="slide" data-project-index="{idx}" data-project-name="{project_name}"',
                slides_content
            )
            all_slides_html.append(slides_content)
        else:
            all_slides_html.append(populated)

    # Combine all slides
    combined_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flash Report - {len(projects_data)} Projects</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background: #1a1a1a;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        }}
        .slide {{
            width: 960px;
            height: 540px;
            position: relative;
            overflow: hidden;
            margin: 20px auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            border-radius: 8px;
            background: #ffffff;
        }}
        .project-divider {{
            text-align: center;
            color: #888;
            font-size: 14px;
            padding: 30px 0 10px;
        }}
    </style>
</head>
<body>
    {"".join(all_slides_html)}
</body>
</html>"""

    return combined_html
