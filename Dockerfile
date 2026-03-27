FROM python:3.12-slim

ARG YTDLP_VERSION=2026.03.17

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
COPY workers/requirements.txt workers/requirements.txt
# Install Python deps but skip yt-dlp (already pinned via curl above)
# Keep filtered file next to original so relative -r paths resolve correctly
RUN grep -v '^yt-dlp' workers/requirements.txt > workers/requirements-filtered.txt \
    && pip install --no-cache-dir -r workers/requirements-filtered.txt \
    && rm workers/requirements-filtered.txt

COPY backend/ backend/
COPY workers/ workers/
COPY config/ config/

CMD ["python", "-m", "workers.worker"]
