"""
Production entry point: one server for both the API and the website.

The API is mounted at /api and the website (the Expo web build in WEB_DIR) at /. Keeping them on one
address means the website's sign-in cookie is first-party, and no CORS setup is needed. Run with
API_PATH_PREFIX=/api so the cookie's path matches (see config.py).

    uvicorn serve:app --host 0.0.0.0 --port $PORT
"""
import os
from pathlib import Path

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles

from main import app as api

WEB_DIR = Path(os.environ.get("WEB_DIR", "mobile/dist"))

def read_headers(path: Path) -> dict[str, str]:
    """The website's security headers, from the _headers file the Expo build copies in (its /* block)."""
    headers: dict[str, str] = {}
    if not path.exists():
        return headers
    in_block = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            in_block = line.strip() == "/*"
            continue
        if in_block and ":" in line:
            name, value = line.strip().split(":", 1)
            headers[name.strip()] = value.strip()
    return headers

class SinglePageApp(StaticFiles):
    """Serves the website's files, and index.html for any other page path (the app routes itself)."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as error:
            # A missing file with an extension is really missing; a page path like /trips/2 is the app's
            if error.status_code != 404 or "." in Path(path).name:
                raise
            return FileResponse(WEB_DIR / "index.html")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
SITE_HEADERS = read_headers(WEB_DIR / "_headers")

@app.middleware("http")
async def website_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        # The API sets its own
        return response
    for name, value in SITE_HEADERS.items():
        response.headers.setdefault(name, value)
    # Built files have a content hash in their name, so they never change; the page itself always might
    if path.startswith("/_expo/static/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response.headers.setdefault("Cache-Control", "no-cache")
    # Anyone with a trip's share link can read it; search engines shouldn't list it
    if path.startswith("/shared/"):
        response.headers["X-Robots-Tag"] = "noindex"
    return response

app.mount("/api", api)
if WEB_DIR.exists():
    app.mount("/", SinglePageApp(directory=WEB_DIR, html=True), name="website")
