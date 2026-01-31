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
1. DO NOT use flexbox (display: flex, inline-flex) - COMPLETELY FORBIDDEN
2. DO NOT use CSS Grid (display: grid, inline-grid) - COMPLETELY FORBIDDEN
3. DO NOT add ANY new CSS rules to the <style> block
4. DO NOT add inline styles that change layout (no style="display: flex" etc)
5. COPY the template's <style> block EXACTLY - character by character
6. The template uses position: absolute - KEEP IT THAT WAY
7. If the original template already has flex/grid in its <style>, keep it but NEVER add new ones
</critical_css_rules>

<pptx_compatibility>
CRITICAL — PRESERVE STRUCTURE FOR PPTX CONVERSION (breaking these = broken PPTX):

1. SECTION NESTING — Each section MUST keep .section-header and .section-box as children
   of the SAME parent div[position:absolute]. NEVER split them into sibling divs.
   The converter reads: div[abs] > .section-header + .section-box

2. FOOTER — .page-number and .logo MUST stay inside .footer-bar as children, not siblings.

3. CLASS NAMES — Preserve ALL existing class names exactly: .top-bar, .date-box, .main-title,
   .footer-bar, .page-number, .logo, .section-header, .section-title, .section-box,
   .bullet-item, .sub-label, .trend-box, .trend-item, .link-text

4. PIXEL WIDTHS — Keep all widths in px. Never convert to percentages.

5. NO FLEX/GRID — Never add display:flex or display:grid.

6. TABLES — Keep as <table><tr><td> with px widths on cells.
</pptx_compatibility>

<overflow_prevention>
OVERFLOW AND TEXT OVERLAP PREVENTION - MANDATORY:
1. Text must NEVER overflow its container or overlap with adjacent elements
2. For long text, ALWAYS reduce font-size inline BEFORE it can overflow
3. Use overflow: hidden on containers that might receive long text
4. Use word-wrap: break-word to prevent single long words from overflowing
5. For multi-line containers, use overflow: hidden and max-height to clip excess
6. NEVER let text from one element visually overlap or cover text from another
7. When in doubt, make text smaller rather than risk overflow
8. Test mentally: if the text is 2x longer than expected, would it still fit? If not, add safeguards
</overflow_prevention>

<icon_safety>
ICONS AND SPECIAL CHARACTERS - CRITICAL:
1. ONLY use basic ASCII characters and standard HTML entities
2. DO NOT use emoji unicode characters (they render inconsistently across systems)
3. DO NOT use icon fonts (FontAwesome, Material Icons, etc.) unless already in the template
4. For status indicators use simple text or HTML symbols:
   - Good: "OK", "Yes", "No", "-", "N/A", "&#9679;" (bullet), "&#9650;" (triangle up), "&#9660;" (triangle down)
   - Good: "&#10003;" (checkmark), "&#10005;" (cross), "&#9733;" (star)
   - BAD: emoji like 🟢🔴⚠️🎯✅❌ (these may render as broken/null characters in PDF)
5. For colored indicators, use a <span> with background-color and border-radius instead of emoji:
   Example: <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;"></span>
6. NEVER use characters from Private Use Area (U+E000–U+F8FF) or rare Unicode blocks
</icon_safety>

<what_you_CAN_do>
You ARE ALLOWED to make these adjustments ONLY via inline styles on individual elements:
1. Reduce font-size on long titles so they fit (e.g., style="font-size: 18px;")
2. Add overflow: hidden and word-wrap: break-word to prevent overflow
3. Add text-overflow: ellipsis with white-space: nowrap for single-line truncation
4. Adjust line-height if text is cramped
5. Add max-height with overflow: hidden for multi-line content
6. These are the ONLY inline style changes permitted - NO layout changes (no flex, grid, float)
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
   - A slide with ONLY headers/footers and no section content is UNACCEPTABLE
   - Every section-box must contain visible content (bullet-items, text, tables, indicators)
   - Fill section-boxes with bullet-items, sub-labels, progress info, team data, timelines, etc.

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

{long_text_strategy_instructions}

<output>
Return ONLY the complete populated HTML document.
- No explanations
- No markdown code blocks
- No ```html wrapper
- Just raw HTML starting with <!DOCTYPE html>
</output>"""


LONG_TEXT_STRATEGY_INSTRUCTIONS = {
    'summarize': """<long_text_strategy>
USER-SELECTED STRATEGY FOR LONG TEXT: **SUMMARIZE**
This is a USER CHOICE that you MUST respect - it overrides your own judgment about text length.

Rules:
1. ANY text field longer than 2 sentences MUST be condensed to a maximum of 2 sentences
2. Preserve the key meaning and most important information
3. Write in the same language as the original text
4. Do NOT simply truncate - actually summarize the content intelligently
5. This applies to ALL text fields: descriptions, achievements, comments, notes, attention points, etc.
6. Even if the text fits visually, still summarize it if it exceeds 2 sentences - the USER wants concise content
</long_text_strategy>""",

    'ellipsis': """<long_text_strategy>
USER-SELECTED STRATEGY FOR LONG TEXT: **TRUNCATE WITH ELLIPSIS**
This is a USER CHOICE that you MUST respect - it overrides your own judgment about text length.

Rules:
1. ANY text field longer than 100 characters MUST be cut at ~100 characters and end with "..."
2. Cut at a word boundary when possible (don't cut mid-word)
3. This applies to ALL text fields: descriptions, achievements, comments, notes, attention points, etc.
4. Do NOT summarize or rephrase - just cut the original text and add "..."
5. Even if the text fits visually, still truncate it if it exceeds 100 characters - the USER wants short content
</long_text_strategy>""",

    'omit': """<long_text_strategy>
USER-SELECTED STRATEGY FOR LONG TEXT: **OMIT**
This is a USER CHOICE that you MUST respect - it overrides your own judgment about text length.

Rules:
1. ANY text field longer than 100 characters MUST be replaced with "-" or left as "N/A"
2. Do NOT show the long text at all - the user explicitly chose to skip long content
3. Short text (under 100 characters) should still be shown normally
4. This applies to ALL text fields: descriptions, achievements, comments, notes, attention points, etc.
5. Even if the text fits visually, still omit it if it exceeds 100 characters - the USER wants to skip long content
</long_text_strategy>""",
}


def populate_html_with_claude(
    html_template: str,
    project_data: Dict[str, Any],
    mapping_json: Dict[str, Any],
    long_text_strategy: str = 'summarize'
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
    strategy_instructions = LONG_TEXT_STRATEGY_INSTRUCTIONS.get(
        long_text_strategy, LONG_TEXT_STRATEGY_INSTRUCTIONS['summarize']
    )
    prompt = POPULATION_PROMPT.format(
        html_template=html_template,
        template_fields=json.dumps(template_fields, indent=2),
        project_data=json.dumps(cleaned_project_data, indent=2, ensure_ascii=False),
        mapping_json=json.dumps(mapping_json, indent=2),
        long_text_strategy_instructions=strategy_instructions
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
1. DO NOT use flexbox (display: flex, inline-flex) - COMPLETELY FORBIDDEN
2. DO NOT use CSS Grid (display: grid, inline-grid) - COMPLETELY FORBIDDEN
3. DO NOT add ANY new CSS rules to the <style> block
4. COPY the template's <style> block EXACTLY - character by character
5. The template uses position: absolute - KEEP IT THAT WAY
6. If the original template already has flex/grid in its <style>, keep it but NEVER add new ones
</critical_css_rules>

<pptx_compatibility>
CRITICAL — PRESERVE STRUCTURE FOR PPTX CONVERSION (breaking these = broken PPTX):

1. SECTION NESTING — Each section MUST keep .section-header and .section-box as children
   of the SAME parent div[position:absolute]. NEVER split them into sibling divs.
   The converter reads: div[abs] > .section-header + .section-box

2. FOOTER — .page-number and .logo MUST stay inside .footer-bar as children, not siblings.

3. CLASS NAMES — Preserve ALL existing class names exactly: .top-bar, .date-box, .main-title,
   .footer-bar, .page-number, .logo, .section-header, .section-title, .section-box,
   .bullet-item, .sub-label, .trend-box, .trend-item, .link-text

4. PIXEL WIDTHS — Keep all widths in px. Never convert to percentages.

5. NO FLEX/GRID — Never add display:flex or display:grid.

6. TABLES — Keep as <table><tr><td> with px widths on cells.
</pptx_compatibility>

<overflow_prevention>
OVERFLOW AND TEXT OVERLAP PREVENTION - MANDATORY:
1. Text must NEVER overflow its container or overlap with adjacent elements
2. For long text, ALWAYS reduce font-size inline BEFORE it can overflow
3. Use overflow: hidden on containers that might receive long text
4. Use word-wrap: break-word to prevent single long words from overflowing
5. For multi-line containers, use overflow: hidden and max-height to clip excess
6. NEVER let text from one element visually overlap or cover text from another
7. When in doubt, make text smaller rather than risk overflow
8. Test mentally: if the text is 2x longer than expected, would it still fit? If not, add safeguards
</overflow_prevention>

<icon_safety>
ICONS AND SPECIAL CHARACTERS - CRITICAL:
1. ONLY use basic ASCII characters and standard HTML entities
2. DO NOT use emoji unicode characters (they render inconsistently across systems)
3. DO NOT use icon fonts (FontAwesome, Material Icons, etc.) unless already in the template
4. For status indicators use simple text or HTML symbols:
   - Good: "OK", "Yes", "No", "-", "N/A", "&#9679;" (bullet), "&#9650;" (triangle up), "&#9660;" (triangle down)
   - Good: "&#10003;" (checkmark), "&#10005;" (cross), "&#9733;" (star)
   - BAD: emoji like 🟢🔴⚠️🎯✅❌ (these may render as broken/null characters in PDF)
5. For colored indicators, use a <span> with background-color and border-radius instead of emoji:
   Example: <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;"></span>
6. NEVER use characters from Private Use Area (U+E000–U+F8FF) or rare Unicode blocks
</icon_safety>

<what_you_CAN_do>
You ARE ALLOWED to make these adjustments ONLY via inline styles on individual elements:
1. Reduce font-size on long titles so they fit (e.g., style="font-size: 16px;")
2. Add overflow: hidden and word-wrap: break-word to prevent overflow
3. Add text-overflow: ellipsis with white-space: nowrap for single-line truncation
4. Adjust line-height if needed for readability
5. Add max-height with overflow: hidden for multi-line content
6. These are the ONLY inline style changes permitted - NO layout changes (no flex, grid, float)
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
   - A slide with ONLY headers/footers and no section content is UNACCEPTABLE
   - Every section-box must contain visible content (bullet-items, text, tables, indicators)
   - Fill section-boxes with bullet-items, sub-labels, progress info, team data, timelines, etc.

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
</output>

{long_text_strategy_instructions}"""


def generate_multi_project_html(
    html_template: str,
    projects_data: List[Dict[str, Any]],
    mapping_json: Dict[str, Any],
    use_claude: bool = True,
    long_text_strategy: str = 'summarize'
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
    strategy_instructions = LONG_TEXT_STRATEGY_INSTRUCTIONS.get(
        long_text_strategy, LONG_TEXT_STRATEGY_INSTRUCTIONS['summarize']
    )
    prompt = MULTI_PROJECT_PROMPT.format(
        html_template=html_template,
        projects_data=json.dumps(cleaned_projects_data, indent=2, ensure_ascii=False),
        mapping_json=json.dumps(mapping_json, indent=2),
        long_text_strategy_instructions=strategy_instructions
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
