# One image for the whole site: the API at /api and the website at / (see serve.py).
#
#   docker build -t triplet .
#   docker run -p 8000:8000 --env-file .env -e API_PATH_PREFIX=/api triplet

# 1. Build the website (the Expo app's web export). It calls the API on its own address, at /api.
FROM node:24-slim AS web
WORKDIR /app/mobile
COPY mobile/package.json mobile/package-lock.json ./
COPY mobile/scripts ./scripts
RUN npm ci
COPY mobile/ ./
ENV EXPO_PUBLIC_API_URL=/api
RUN npx expo export --platform web --output-dir dist

# 2. The server
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WEB_DIR=/app/web \
    API_PATH_PREFIX=/api
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY . .
COPY --from=web /app/mobile/dist ./web

# Don't run as root
RUN useradd --create-home triplet
USER triplet

EXPOSE 8000
# Bring the database up to date, then serve. Hosts like Render set PORT.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn serve:app --host 0.0.0.0 --port ${PORT:-8000}"]
