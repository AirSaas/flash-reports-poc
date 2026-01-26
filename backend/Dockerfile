# Flash Reports Backend Dockerfile
# Multi-stage build for production deployment on Render

# =============================================================================
# Stage 1: Node.js for PPTX converter
# =============================================================================
FROM node:20-slim AS node-builder

WORKDIR /app/pptx_converter

# Copy package files
COPY pptx_converter/package.json ./

# Install dependencies
RUN npm install --production

# =============================================================================
# Stage 2: Python application
# =============================================================================
FROM python:3.11-slim

# Install Node.js (required for pptxgenjs converter)
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Node.js dependencies from builder
COPY --from=node-builder /app/pptx_converter/node_modules ./pptx_converter/node_modules

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8000

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
