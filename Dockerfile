FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    APP_ENV=production \
    SQL_MCP_DIALECT=postgresql \
    SQL_MCP_SCHEMA=business

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && pip install --no-cache-dir -r backend/requirements.txt \
    && pip install --no-cache-dir -e sql-mcp -e doc-retrieval \
    && pip install --no-cache-dir -r voice-agent/requirements.txt

EXPOSE 8000

CMD ["sh", "-c", "python scripts/migrate_sqlite_to_postgres.py --init-rag && cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
