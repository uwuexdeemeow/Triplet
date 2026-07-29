from fastapi import FastAPI
from routers import auth

app = FastAPI(
    title="Triplet API",
    description="Trip planning aplication API",
    version="1.0.0"
)

app.include_router(auth.router)

@app.get("/")
def root():
    return {
        "message": "Triplet API is running"
    }