from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from routers import auth, users, trips, guest, members, invitations, activities, links, places, expenses, plan_draft, ask

app = FastAPI(
    title="Triplet API",
    description="Trip planning aplication API",
    version="1.0.0",
    # The interactive docs map out every endpoint; keep them to development
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Nothing the app sends is anywhere near this; bigger bodies are refused before they're read
MAX_BODY_BYTES = 1_000_000

@app.middleware("http")
async def guard_requests(request: Request, call_next):
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
        return JSONResponse(status_code=status.HTTP_413_CONTENT_TOO_LARGE, content={"detail": "Request is too large"})

    response = await call_next(request)
    # The API only returns JSON: don't let browsers guess types, frame it, or cache private data
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cache-Control", "no-store")
    if settings.is_production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

# Lets the web version of the app call the API from the browser. Phone apps don't need this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # The website's refresh token travels in a cookie
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Refresh-Cookie"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(trips.router)
app.include_router(members.router)
app.include_router(invitations.router)
app.include_router(activities.router)
app.include_router(links.router)
app.include_router(places.router)
app.include_router(expenses.router)
app.include_router(plan_draft.router)
app.include_router(ask.router)
app.include_router(links.image_router)
app.include_router(guest.router)
app.include_router(guest.setup_router)

# Reusable global interceptor for input validation errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Check if the error originates from the email field
    for error in exc.errors():
        if "email" in error.get("loc", []):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                content={"detail": "Invalid email format"}  # Flat, simple text
            )
     # 2. CRITICAL FIX: Fallback response for other fields (username, password, etc.)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": "Invalid input data"}
    )

@app.get("/")
def root():
    return {
        "message": "Triplet API is running"
    }