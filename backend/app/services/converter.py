"""
PPTX to PNG Conversion Service

Pipeline: PPTX → PDF (via LibreOffice) → PNG (via pdftoppm)
"""

import subprocess
import tempfile
import shutil
from pathlib import Path
from PIL import Image
import io
from typing import List, Tuple, Union

from app.config import SOFFICE_PATH


def optimize_image(img_bytes: bytes, max_size: int = 2048) -> Tuple[bytes, str]:
    """
    Optimize an image for sending to Claude with high quality.
    Returns (optimized_bytes, media_type)
    """
    img = Image.open(io.BytesIO(img_bytes))

    # Convert to RGB if needed
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')

    # Resize if too large
    width, height = img.size
    if width > max_size or height > max_size:
        ratio = min(max_size / width, max_size / height)
        new_size = (int(width * ratio), int(height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    # Save as PNG
    output = io.BytesIO()
    img.save(output, format='PNG', optimize=True)
    return output.getvalue(), "image/png"


def convert_pptx_to_images(
    pptx_bytes: bytes,
    filename: str = "template.pptx",
    return_pdf: bool = False
) -> Union[List[Tuple[bytes, str]], Tuple[List[Tuple[bytes, str]], bytes]]:
    """
    Convert a PPTX file to high resolution PNG images.

    Pipeline: PPTX → PDF (LibreOffice) → PNG (pdftoppm at 300 DPI)

    Args:
        pptx_bytes: The PPTX file content as bytes
        filename: Original filename (for temp file naming)
        return_pdf: If True, also return the intermediate PDF bytes

    Returns:
        If return_pdf=False: List of (image_bytes, media_type) tuples, one per slide
        If return_pdf=True: Tuple of (images_list, pdf_bytes)
    """
    images: List[Tuple[bytes, str]] = []
    pdf_bytes: bytes = b""

    with tempfile.TemporaryDirectory() as tmpdir:
        # Write PPTX to temp file
        tmp_pptx = Path(tmpdir) / filename
        tmp_pptx.write_bytes(pptx_bytes)

        # Convert PPTX to PDF using LibreOffice
        result = subprocess.run(
            [
                SOFFICE_PATH,
                "--headless",
                "--convert-to", "pdf",
                "--outdir", tmpdir,
                str(tmp_pptx)
            ],
            capture_output=True,
            text=True,
            timeout=120
        )

        if result.returncode != 0:
            raise RuntimeError(f"LibreOffice conversion failed: {result.stderr}")

        # Find the generated PDF
        pdf_files = list(Path(tmpdir).glob("*.pdf"))

        if pdf_files:
            pdf_path = pdf_files[0]

            # Read PDF bytes if requested
            if return_pdf:
                pdf_bytes = pdf_path.read_bytes()

            # Convert PDF to high-resolution PNGs using pdftoppm
            try:
                subprocess.run(
                    ["pdftoppm", "-png", "-r", "300", str(pdf_path), f"{tmpdir}/slide"],
                    capture_output=True,
                    timeout=180,
                    check=True
                )

                # Find generated PNG files
                png_files = sorted(Path(tmpdir).glob("slide-*.png"))

                if png_files:
                    for png_file in png_files:
                        optimized = optimize_image(png_file.read_bytes(), max_size=2048)
                        images.append(optimized)
                    if return_pdf:
                        return images, pdf_bytes
                    return images

            except subprocess.CalledProcessError as e:
                print(f"pdftoppm failed: {e.stderr}")
            except FileNotFoundError:
                print("pdftoppm not found, falling back to LibreOffice PNG export")

        # Fallback: Direct PPTX to PNG conversion via LibreOffice
        result = subprocess.run(
            [
                SOFFICE_PATH,
                "--headless",
                "--convert-to", "png",
                "--outdir", tmpdir,
                str(tmp_pptx)
            ],
            capture_output=True,
            text=True,
            timeout=120
        )

        png_files = sorted(Path(tmpdir).glob("*.png"))

        if not png_files:
            raise RuntimeError(f"No images were generated. Error: {result.stderr}")

        for png_file in png_files:
            optimized = optimize_image(png_file.read_bytes(), max_size=2048)
            images.append(optimized)

    if return_pdf:
        return images, pdf_bytes
    return images


def convert_pptx_file_to_images(pptx_path: Path) -> List[Tuple[bytes, str]]:
    """
    Convenience function to convert a PPTX file path to images.
    """
    pptx_bytes = pptx_path.read_bytes()
    return convert_pptx_to_images(pptx_bytes, pptx_path.name)
