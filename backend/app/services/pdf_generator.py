"""
PDF Generator Service

Converts HTML reports to PDF using WeasyPrint.
"""

from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration
import io


def html_to_pdf(html_content: str) -> bytes:
    """
    Convert HTML content to PDF bytes with landscape orientation.

    Args:
        html_content: Full HTML document string

    Returns:
        PDF file content as bytes
    """
    font_config = FontConfiguration()

    # Create HTML object from string
    html = HTML(string=html_content)

    # Custom CSS to ensure proper page breaks and landscape sizing
    # Using 297mm x 167mm (16:9 ratio, roughly A4 width in landscape)
    css = CSS(string='''
        @page {
            size: 297mm 167mm;  /* 16:9 ratio landscape - width x height */
            margin: 0;
        }

        html, body {
            margin: 0;
            padding: 0;
            width: 297mm;
            height: 167mm;
        }

        .slide {
            page-break-after: always;
            page-break-inside: avoid;
            width: 297mm;
            height: 167mm;
            position: relative;
            overflow: hidden;
            box-sizing: border-box;
        }

        .slide:last-child {
            page-break-after: auto;
        }
    ''', font_config=font_config)

    # Generate PDF
    pdf_bytes = html.write_pdf(
        stylesheets=[css],
        font_config=font_config
    )

    return pdf_bytes


def html_to_pdf_a4(html_content: str) -> bytes:
    """
    Convert HTML content to PDF with A4 landscape pages.

    Args:
        html_content: Full HTML document string

    Returns:
        PDF file content as bytes
    """
    font_config = FontConfiguration()

    html = HTML(string=html_content)

    # A4 landscape: 297mm x 210mm
    css = CSS(string='''
        @page {
            size: 297mm 210mm;  /* A4 landscape - width x height */
            margin: 10mm;
        }

        html, body {
            margin: 0;
            padding: 0;
            width: 277mm;  /* 297mm - 2*10mm margin */
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        }

        .slide {
            page-break-after: always;
            page-break-inside: avoid;
            width: 277mm;
            height: 190mm;  /* 210mm - 2*10mm margin */
            position: relative;
            overflow: hidden;
            box-sizing: border-box;
        }

        .slide:last-child {
            page-break-after: auto;
        }
    ''', font_config=font_config)

    pdf_bytes = html.write_pdf(
        stylesheets=[css],
        font_config=font_config
    )

    return pdf_bytes
