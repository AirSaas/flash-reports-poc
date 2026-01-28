"""
Claude Vision HTML Generation Service

Uses Claude's vision capabilities to convert slide images into pixel-perfect HTML templates.
"""

import anthropic
import base64
import json
from typing import List, Tuple, Dict, Any

from app.config import ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS


# Initialize Anthropic client
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


# Base prompt for generating HTML template from slide images
HTML_TEMPLATE_PROMPT_BASE = """<role>
You are an elite frontend developer with 15+ years of experience in pixel-perfect HTML/CSS replication.
Your specialty is converting visual designs into flawless, production-ready code.
</role>

<task>
Analyze each slide image and generate HTML/CSS that replicates EXACTLY its visual appearance.
Your goal is to create a replica so faithful that when placed side-by-side with the original,
they are completely indistinguishable.

CRITICAL - TEMPLATE GENERATION:
This is a TEMPLATE for dynamic data population. For any text that appears to be variable/dynamic data
(project names, dates, numbers, status values, percentages, person names, descriptions, metrics, etc.),
you MUST replace it with a placeholder using this exact format: {{field_name}}

{field_instructions}

KEEP AS STATIC TEXT (do not templatize):
- Section headers/labels like "Project Overview", "Status", "Budget", "Timeline"
- Column headers in tables
- UI labels and navigation text
- Generic instructional text
</task>

{long_text_instructions}

<character_encoding>
CRITICAL - CHARACTER HANDLING:
- Use standard ASCII characters for all bullets and symbols
- For bullet points, use these HTML entities or CSS:
  • Use "•" (bullet) or CSS list-style-type: disc
  • Use "–" for en-dash, "—" for em-dash
  • Use "→" for arrows
- NEVER output garbled characters like "â–ª", "â€"", "â€™"
- If you see special Unicode characters in the image, convert them to their HTML entity equivalents
- For checkmarks use ✓ or &#10003;
- For X marks use ✗ or &#10007;
- Ensure the HTML has: <meta charset="UTF-8">
</character_encoding>

<design_principles>
- Extract and replicate the EXACT colors from the image (use hex codes like #FF5733)
- Maintain precise proportions and relative positioning of every element
- Preserve the visual hierarchy: large titles → medium subtitles → small body text
- Match spacing between elements pixel-for-pixel
- Replicate fonts as closely as possible (use Arial, Helvetica, or system fonts)
- Match font weights (bold, semibold, regular, light)
- Preserve text alignment (left, center, right, justified)
</design_principles>

<layout_rules>
- FIXED dimensions: 960px width × 540px height (16:9 aspect ratio)
- Use position: absolute with top/left values in pixels for precise placement
- ALL elements must fit WITHIN the 960×540 container - no overflow
- Use overflow: hidden on each .slide container
- Layer elements with z-index when they overlap
- Use percentage widths inside containers for responsive internal layouts
</layout_rules>

<text_handling>
- Calculate font-size to ensure ALL text fits without truncation
- Use appropriate line-height (typically 1.2-1.5) for readability
- Apply word-wrap: break-word and overflow-wrap: break-word for long text
- Use text-overflow: ellipsis only as a last resort
</text_handling>

<list_formatting>
CRITICAL - PROPER HTML LISTS:
- For ANY bullet points or list items, you MUST use proper HTML structure:
  <ul>
    <li>First item</li>
    <li>Second item</li>
  </ul>
- NEVER use raw bullet characters (*, -, etc.) in plain text
- NEVER output lists as: "* Item 1 * Item 2" in a single paragraph
- Style lists with CSS:
  ul {{ list-style-type: disc; padding-left: 20px; margin: 10px 0; }}
  li {{ margin-bottom: 5px; }}
- For numbered lists, use <ol> with list-style-type: decimal
- For custom bullets, use ::before pseudo-element or list-style-image
- Nested lists should be properly indented with nested <ul>/<ol> elements
</list_formatting>

<boxes_and_containers>
When replicating boxes, cards, or bordered containers:
- Content must be completely INSIDE the border with proper padding
- Use padding: 15-20px to separate content from borders
- For lists inside boxes: account for bullet width + text width
- Calculate usable width: container_width - padding_left - padding_right
- Match border-radius exactly (rounded corners)
- Replicate box-shadow if present
- Match background colors and gradients precisely
</boxes_and_containers>

<tables_and_grids>
For tables and grid layouts:
- Use CSS Grid or Flexbox for complex layouts
- Match column widths proportionally
- Replicate header styling (background color, font weight, borders)
- Alternate row colors if present in the original
- Match cell padding and text alignment
</tables_and_grids>

<quality_checklist>
Before finalizing, verify each slide against this checklist:
1. ✓ Colors match exactly (compare hex values)
2. ✓ Element positions are pixel-accurate
3. ✓ All text is visible and not cut off
4. ✓ Font sizes and weights match the original
5. ✓ Lists and bullets are properly formatted with clean characters
6. ✓ Boxes contain their content with proper padding
7. ✓ No elements overlap incorrectly
8. ✓ All dynamic data replaced with {{field_name}} placeholders
9. ✓ No garbled Unicode characters (â–ª, â€", etc.)
10. ✓ Visual hierarchy is preserved
</quality_checklist>

<output_format>
Generate a complete, valid HTML5 document with:
- <!DOCTYPE html>
- <html lang="en">
- <head> with <meta charset="UTF-8"> and <style> tag
- <body> with background: #1a1a1a and padding: 20px
- Each slide as: <div class="slide" data-slide-number="N">
- Include data-field="field_name" attribute on elements containing placeholders
</output_format>"""


FINAL_INSTRUCTIONS = """

<final_instructions>
Generate the complete HTML document that perfectly replicates each slide shown above.

REQUIRED BASE CSS:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    background: #1a1a1a;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
}
.slide {
    width: 960px;
    height: 540px;
    position: relative;
    overflow: hidden;
    margin: 20px auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    border-radius: 8px;
    background: #ffffff;
}
```

REMEMBER:
1. Replace ALL dynamic/variable data with {{field_name}} placeholders
2. Use clean ASCII/HTML entities for bullets and special characters
3. Ensure pixel-perfect accuracy in positioning and styling
4. The output must be production-ready HTML

Your response must be professional, high-quality HTML that is visually IDENTICAL to the original images.
</final_instructions>"""


def build_long_text_instructions(strategy: str = 'summarize') -> str:
    """
    Build instructions for handling long text based on user's selected strategy.

    Args:
        strategy: 'summarize' | 'ellipsis' | 'omit'

    Returns:
        String with long text handling instructions for the prompt
    """
    base_intro = """<long_text_handling>
IMPORTANT: The user has selected a specific strategy for handling long text content.
When you encounter text fields that contain lengthy content (descriptions, notes, comments, etc.),
you MUST apply this strategy:
"""

    if strategy == 'summarize':
        return base_intro + """
STRATEGY: SUMMARIZE
- For long descriptions, project notes, or detailed text: CREATE A CONCISE SUMMARY
- Keep the essential meaning but reduce to 1-2 sentences max
- Focus on key points, outcomes, and important metrics
- Example: A 500-word project description → "Cloud migration project focused on reducing infrastructure costs by 40% while improving system reliability."
- Preserve critical data like numbers, dates, and status information
- The summary should fit comfortably in the designated space without overflow
</long_text_handling>"""

    elif strategy == 'ellipsis':
        return base_intro + """
STRATEGY: TRUNCATE WITH ELLIPSIS
- For long text: TRUNCATE and add "..." at the end
- Cut the text at a natural break point (end of word/sentence) that fits the container
- Always end truncated text with "..."
- Example: "This is a very long project description that..."
- Ensure the truncated text + ellipsis fits within the element's boundaries
- Do NOT summarize or paraphrase - just cut and add ellipsis
- Preserve the beginning of the text as-is
</long_text_handling>"""

    elif strategy == 'omit':
        return base_intro + """
STRATEGY: OMIT LONG TEXT
- For long text fields: REPLACE with a short placeholder or leave minimal content
- Use placeholders like "-", "See details", or "N/A" for lengthy content
- Keep only short, essential text (titles, status, dates, numbers)
- Example: A long description field → "-" or "Details available"
- This keeps the slides clean and focused on key metrics
- Short text (under ~50 characters) can remain as-is
</long_text_handling>"""

    else:
        # Default to summarize if unknown strategy
        return build_long_text_instructions('summarize')


def build_field_instructions(mapping_json: Dict[str, Any] = None) -> str:
    """
    Build dynamic field instructions based on user's mapping configuration.

    Args:
        mapping_json: The user's mapping configuration

    Returns:
        String with field naming instructions for the prompt
    """
    if not mapping_json:
        # Fallback to generic instructions if no mapping provided
        return """Use descriptive field names in snake_case:
- "Project Alpha" → {{project_name}}
- "John Smith" → {{owner_name}} or {{manager_name}}
- "2024-01-15" → {{start_date}} or {{end_date}}
- "85%" → {{progress_percentage}} or {{completion_rate}}
- "In Progress" → {{status}} or {{project_status}}
- "$150,000" → {{budget_amount}} or {{total_budget}}
- "Q1 2024" → {{quarter}} or {{period}}
- List items → {{item_1_name}}, {{item_2_name}}, {{item_3_name}}, etc.
- Milestone names → {{milestone_1}}, {{milestone_2}}, etc."""

    # Build instructions from the user's mapping
    instructions = ["USE EXACTLY THESE FIELD NAMES from the user's mapping configuration:"]
    instructions.append("")

    for field_name, field_config in mapping_json.items():
        if isinstance(field_config, dict):
            data_path = field_config.get('path', field_config.get('source', 'unknown'))
            description = field_config.get('description', '')
        else:
            data_path = str(field_config)
            description = ''

        example = f"  - {{{{{{field_name}}}}}} → maps to: {data_path}"
        if description:
            example += f" ({description})"
        instructions.append(example)

    instructions.append("")
    instructions.append("For any ADDITIONAL dynamic content not in the mapping above,")
    instructions.append("use descriptive snake_case names like: {{additional_field_1}}, {{metric_value}}, etc.")
    instructions.append("")
    instructions.append("IMPORTANT: The field names MUST match the mapping exactly so data population works correctly.")

    return "\n".join(instructions)


def generate_html_template(
    images: List[Tuple[bytes, str]],
    mapping_json: Dict[str, Any] = None,
    long_text_strategy: str = 'summarize'
) -> Dict[str, Any]:
    """
    Use Claude Vision to generate an HTML template from slide images.

    Args:
        images: List of (image_bytes, media_type) tuples
        mapping_json: Optional mapping configuration to use exact field names
        long_text_strategy: How to handle long text ('summarize', 'ellipsis', 'omit')

    Returns:
        Dictionary with 'full_html' and 'fields' keys
    """
    content = []

    # Build dynamic instructions based on mapping and long text strategy
    field_instructions = build_field_instructions(mapping_json)
    long_text_instructions = build_long_text_instructions(long_text_strategy)
    prompt_text = HTML_TEMPLATE_PROMPT_BASE.format(
        field_instructions=field_instructions,
        long_text_instructions=long_text_instructions
    )

    # Add the main prompt
    content.append({
        "type": "text",
        "text": prompt_text
    })

    # Add each slide image
    for i, (img_bytes, media_type) in enumerate(images, 1):
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')
        content.append({
            "type": "text",
            "text": f"\n--- SLIDE {i} of {len(images)} ---"
        })
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": img_base64
            }
        })

    # Add final instructions
    content.append({
        "type": "text",
        "text": FINAL_INSTRUCTIONS
    })

    # Call Claude Opus 4.5 with structured output
    collected_text = ""

    with client.beta.messages.stream(
        model=CLAUDE_MODEL,  # claude-opus-4-5-20251101
        max_tokens=CLAUDE_MAX_TOKENS,
        temperature=0.2,  # Small amount of creativity for better visual interpretation
        betas=["structured-outputs-2025-11-13"],
        messages=[
            {
                "role": "user",
                "content": content
            }
        ],
        output_format={
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "full_html": {
                        "type": "string",
                        "description": "The complete HTML code for the presentation template, including DOCTYPE, head with styles, and body with all slides. All dynamic data must be replaced with {{field_name}} placeholders. Use clean ASCII characters for bullets."
                    },
                    "fields": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field_name": {"type": "string"},
                                "slide_number": {"type": "integer"},
                                "description": {"type": "string"},
                                "example_value": {"type": "string"}
                            },
                            "required": ["field_name", "slide_number"],
                            "additionalProperties": False
                        },
                        "description": "List of all template fields found in the HTML with their slide numbers and descriptions"
                    }
                },
                "required": ["full_html", "fields"],
                "additionalProperties": False
            }
        }
    ) as stream:
        for text in stream.text_stream:
            collected_text += text
            print(".", end="", flush=True)

    print()  # Newline after progress dots

    result = json.loads(collected_text)

    # Post-process to fix any remaining character encoding issues
    if "full_html" in result:
        result["full_html"] = fix_character_encoding(result["full_html"])

    return result


def fix_character_encoding(html: str) -> str:
    """
    Fix common character encoding issues in generated HTML.
    Replaces garbled UTF-8 characters with clean ASCII/HTML entities.
    """
    result = html

    # FIRST: Fix mojibake (UTF-8 interpreted as Latin-1/Windows-1252)
    # Using Unicode escape sequences to avoid syntax errors
    mojibake_fixes = [
        # Bullets - mojibake patterns
        ("\u00e2\u20ac\u00a2", "*"),      # â€¢ -> • bullet
        ("\u00e2\u0096\u00aa", "*"),      # â–ª -> ▪ small square
        ("\u00e2\u0097\u00a6", "*"),      # â—¦ -> ◦ white bullet
        ("\u00e2\u0097\u2039", "*"),      # â—‹ -> ○ white circle
        ("\u00e2\u0097", "*"),            # â— -> ● black circle prefix
        # Dashes - mojibake patterns
        ("\u00e2\u20ac\u201c", "-"),      # â€" -> – en-dash
        ("\u00e2\u20ac\u201d", "-"),      # â€" -> — em-dash (different encoding)
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
    ]

    for bad, good in mojibake_fixes:
        result = result.replace(bad, good)

    # SECOND: Replace Unicode characters with ASCII equivalents
    # Bullets
    result = result.replace("\u2022", "*")  # bullet •
    result = result.replace("\u25aa", "*")  # small square ▪
    result = result.replace("\u25cf", "*")  # black circle ●
    result = result.replace("\u2023", "*")  # triangular bullet ‣
    result = result.replace("\u2043", "-")  # hyphen bullet ⁃
    result = result.replace("\u25e6", "*")  # white bullet ◦

    # Dashes
    result = result.replace("\u2013", "-")  # en-dash –
    result = result.replace("\u2014", "-")  # em-dash —
    result = result.replace("\u2015", "-")  # horizontal bar ―

    # Quotes
    result = result.replace("\u2018", "'")  # left single quote '
    result = result.replace("\u2019", "'")  # right single quote '
    result = result.replace("\u201c", '"')  # left double quote "
    result = result.replace("\u201d", '"')  # right double quote "
    result = result.replace("\u201a", ",")  # single low quote ‚
    result = result.replace("\u201e", '"')  # double low quote „

    # Arrows
    result = result.replace("\u2192", "->")  # right arrow →
    result = result.replace("\u2190", "<-")  # left arrow ←
    result = result.replace("\u2191", "^")   # up arrow ↑
    result = result.replace("\u2193", "v")   # down arrow ↓

    # Spaces
    result = result.replace("\u00a0", " ")   # non-breaking space
    result = result.replace("\u202f", " ")   # narrow no-break space

    # Checkmarks and crosses
    result = result.replace("\u2713", "[x]")  # check mark ✓
    result = result.replace("\u2714", "[x]")  # heavy check mark ✔
    result = result.replace("\u2717", "[ ]")  # ballot x ✗
    result = result.replace("\u2718", "[ ]")  # heavy ballot x ✘

    return result


def extract_template_fields(html_content: str) -> List[dict]:
    """
    Extract all {{field_name}} placeholders from the HTML template.

    Returns:
        List of field dictionaries with name and context
    """
    import re

    fields = []
    pattern = r'\{\{(\w+)\}\}'

    # Find all unique field names
    matches = set(re.findall(pattern, html_content))

    for field_name in matches:
        fields.append({
            "field_name": field_name,
            "placeholder": f"{{{{{field_name}}}}}"
        })

    return fields
