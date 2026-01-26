/**
 * PPTX Converter - Converts HTML slides to PowerPoint format
 * Based on Jerry's presentation_app converter.
 *
 * Usage: node convert.js <input.json> <output.pptx>
 */

import pptxgen from "pptxgenjs";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

// Slide dimensions (16:9 aspect ratio)
const SLIDE_WIDTH = 10; // inches
const SLIDE_HEIGHT = 5.625; // inches
const HTML_WIDTH = 960; // pixels
const HTML_HEIGHT = 540; // pixels

/**
 * Convert pixel value to inches for PPTX
 */
function pxToInches(px, dimension = "width") {
  const ratio = dimension === "width" ? SLIDE_WIDTH / HTML_WIDTH : SLIDE_HEIGHT / HTML_HEIGHT;
  return px * ratio;
}

/**
 * Parse CSS color value
 */
function parseColor(color) {
  if (!color) return null;

  // Handle hex colors
  if (color.startsWith("#")) {
    return color.replace("#", "").toUpperCase();
  }

  // Handle rgb/rgba
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }

  // Handle named colors
  const namedColors = {
    white: "FFFFFF",
    black: "000000",
    red: "FF0000",
    green: "00FF00",
    blue: "0000FF",
    yellow: "FFFF00",
    gray: "808080",
    grey: "808080",
  };

  return namedColors[color.toLowerCase()] || null;
}

/**
 * Parse font size from CSS value
 */
function parseFontSize(fontSize) {
  if (!fontSize) return 18;

  const match = fontSize.match(/(\d+(?:\.\d+)?)(px|pt|em|rem)?/);
  if (!match) return 18;

  let size = parseFloat(match[1]);
  const unit = match[2] || "px";

  // Convert to points
  switch (unit) {
    case "px":
      size = size * 0.75; // 1px ≈ 0.75pt
      break;
    case "em":
    case "rem":
      size = size * 12; // Assume 1em = 12pt
      break;
    // pt stays as is
  }

  return Math.round(size);
}

/**
 * Extract text and styling from HTML element
 */
function extractTextFromElement(element, inheritedStyle = {}) {
  const texts = [];
  const computedStyle = element.style || {};

  const style = {
    ...inheritedStyle,
    bold: computedStyle.fontWeight === "bold" || parseInt(computedStyle.fontWeight) >= 700,
    italic: computedStyle.fontStyle === "italic",
    color: parseColor(computedStyle.color) || inheritedStyle.color,
    fontSize: parseFontSize(computedStyle.fontSize) || inheritedStyle.fontSize,
  };

  for (const child of element.childNodes) {
    if (child.nodeType === 3) {
      // Text node
      const text = child.textContent.trim();
      if (text) {
        texts.push({ text, options: { ...style } });
      }
    } else if (child.nodeType === 1) {
      // Element node
      const tagName = child.tagName.toLowerCase();

      // Handle specific tags
      if (tagName === "br") {
        texts.push({ text: "\n", options: {} });
      } else if (tagName === "b" || tagName === "strong") {
        texts.push(...extractTextFromElement(child, { ...style, bold: true }));
      } else if (tagName === "i" || tagName === "em") {
        texts.push(...extractTextFromElement(child, { ...style, italic: true }));
      } else if (tagName === "h1" || tagName === "h2" || tagName === "h3") {
        const headingSizes = { h1: 36, h2: 28, h3: 24 };
        texts.push(...extractTextFromElement(child, { ...style, bold: true, fontSize: headingSizes[tagName] }));
        texts.push({ text: "\n", options: {} });
      } else if (tagName === "p") {
        texts.push(...extractTextFromElement(child, style));
        texts.push({ text: "\n", options: {} });
      } else if (tagName === "li") {
        texts.push({ text: "• ", options: style });
        texts.push(...extractTextFromElement(child, style));
        texts.push({ text: "\n", options: {} });
      } else {
        texts.push(...extractTextFromElement(child, style));
      }
    }
  }

  return texts;
}

/**
 * Process a single slide's HTML and add to presentation
 */
function processSlide(pptx, slideData, theme = {}) {
  const slide = pptx.addSlide();

  // Apply background
  if (theme.backgroundColor) {
    slide.background = { color: parseColor(theme.backgroundColor) || "FFFFFF" };
  }

  // Parse HTML
  const dom = new JSDOM(slideData.html);
  const document = dom.window.document;
  const body = document.body;

  // Extract background from root element
  const rootElement = body.firstElementChild;
  if (rootElement) {
    const bgColor = rootElement.style.backgroundColor;
    if (bgColor) {
      slide.background = { color: parseColor(bgColor) || "FFFFFF" };
    }
  }

  // Extract all text content
  const textContent = extractTextFromElement(body, {
    fontSize: 18,
    color: theme.textColor ? parseColor(theme.textColor) : "333333",
  });

  // If we have text, add it to the slide
  if (textContent.length > 0) {
    // Filter out empty entries and format for pptxgenjs
    const formattedText = textContent
      .filter((t) => t.text)
      .map((t) => ({
        text: t.text,
        options: {
          bold: t.options.bold || false,
          italic: t.options.italic || false,
          fontSize: t.options.fontSize || 18,
          color: t.options.color || "333333",
        },
      }));

    if (formattedText.length > 0) {
      slide.addText(formattedText, {
        x: 0.5,
        y: 0.5,
        w: SLIDE_WIDTH - 1,
        h: SLIDE_HEIGHT - 1,
        valign: "top",
        fontFace: theme.fontFamily || "Arial",
        fontSize: 18,
        color: theme.textColor ? parseColor(theme.textColor) : "333333",
      });
    }
  }

  // Add speaker notes if present
  if (slideData.notes) {
    slide.addNotes(slideData.notes);
  }

  return slide;
}

/**
 * Main conversion function
 */
async function convertToPptx(inputPath, outputPath) {
  // Read input JSON
  const inputData = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  const { title, slides, theme = {} } = inputData;

  // Create presentation
  const pptx = new pptxgen();

  // Set presentation properties
  pptx.title = title || "Flash Report";
  pptx.author = "Flash Reports";
  pptx.subject = "Project Portfolio Report";

  // Set slide dimensions (16:9)
  pptx.defineLayout({ name: "CUSTOM", width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pptx.layout = "CUSTOM";

  // Process each slide
  for (const slideData of slides) {
    processSlide(pptx, slideData, theme);
  }

  // Write output file
  await pptx.writeFile({ fileName: outputPath });

  console.log(`✅ Created PPTX with ${slides.length} slides: ${outputPath}`);

  return outputPath;
}

// CLI entry point
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("Usage: node convert.js <input.json> <output.pptx>");
  process.exit(1);
}

const [inputPath, outputPath] = args;

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

convertToPptx(inputPath, outputPath)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Conversion failed:", error);
    process.exit(1);
  });

export { convertToPptx, pxToInches, parseColor, parseFontSize };
