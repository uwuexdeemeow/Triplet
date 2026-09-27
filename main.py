from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from routers import auth, users, trips, guest, members, invitations, activities, links, places, expenses, plan_draft

app = FastAPI(
    title="Triplet API",
    description="Trip planning aplication API",
    version="1.0.0"
)

# Lets the web version of the app call the API from the browser. Phone apps don't need this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
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